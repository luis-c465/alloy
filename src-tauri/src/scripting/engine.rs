//! Boa-based JavaScript execution engine for pre-request and post-response scripts.
//!
//! The engine creates a fresh `Context` for each script execution (Boa contexts
//! are `!Send`, so callers must invoke these functions from a blocking task).
//! The global `alloy` API is exposed with a Postman-like shape:
//!
//! - `alloy.request.{method, url, body, headers, queryParams}`
//! - `alloy.response.{code, status, headers, text(), json(), responseTime, responseSize}` (post-response only)
//! - `alloy.environment.{get, set, has, unset, toObject}`
//! - `alloy.variables.{get, set, has, unset, toObject}`
//! - `alloy.info.{eventName, requestName}`
//! - `alloy.console.{log, warn, error, info, debug}`
//!
//! Shared mutable state is held in an `Rc<RefCell<ScriptState>>` passed to every
//! closure. Because `Rc<RefCell<_>>` is not `Copy` and holds no traceable GC
//! roots, closures are registered with the `unsafe` `NativeFunction::from_closure`
//! API. This is safe here because the captured state only references Rust-owned
//! values; no `JsObject`/`JsValue` is retained across calls.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use boa_engine::{
    js_string,
    native_function::NativeFunction,
    object::{FunctionObjectBuilder, JsObject, ObjectInitializer},
    property::{Attribute, PropertyDescriptor},
    Context, JsError, JsNativeError, JsResult, JsString, JsValue, Source,
};

use crate::http::types::KeyValue;
use crate::scripting::types::{
    PostResponseScriptContext, PreRequestScriptContext, PreRequestScriptMutations,
    ScriptConsoleEntry, ScriptResult,
};

const PRE_REQUEST_PHASE: &str = "pre-request";
const POST_RESPONSE_PHASE: &str = "post-response";

#[derive(Clone, Copy)]
enum KeyValueCollection {
    Headers,
    QueryParams,
}

#[derive(Clone, Copy)]
enum EnvironmentScope {
    Environment,
    Variables,
}

struct ScriptState {
    phase: &'static str,
    request_name: Option<String>,

    method: String,
    url: String,
    headers: Vec<KeyValue>,
    query_params: Vec<KeyValue>,
    body: Option<String>,

    response_status: u16,
    response_status_text: String,
    response_headers: Vec<KeyValue>,
    response_body: String,
    response_time_ms: u64,
    response_size_bytes: u64,

    environment_variables: HashMap<String, String>,
    variables: HashMap<String, String>,
    modified_environment_variables: HashMap<String, String>,
    unset_environment_variables: Vec<String>,

    console_output: Vec<ScriptConsoleEntry>,
    has_response_object: bool,
}

impl ScriptState {
    fn from_pre_request(ctx: PreRequestScriptContext) -> Self {
        Self {
            phase: PRE_REQUEST_PHASE,
            request_name: ctx.request_name,
            method: ctx.method,
            url: ctx.url,
            headers: ctx.headers,
            query_params: ctx.query_params,
            body: ctx.body,
            response_status: 0,
            response_status_text: String::new(),
            response_headers: Vec::new(),
            response_body: String::new(),
            response_time_ms: 0,
            response_size_bytes: 0,
            environment_variables: ctx.environment_variables,
            variables: ctx.local_variables,
            modified_environment_variables: HashMap::new(),
            unset_environment_variables: Vec::new(),
            console_output: Vec::new(),
            has_response_object: false,
        }
    }

    fn from_post_response(ctx: PostResponseScriptContext) -> Self {
        Self {
            phase: POST_RESPONSE_PHASE,
            request_name: ctx.request_name,
            method: ctx.method,
            url: ctx.url,
            headers: ctx.request_headers,
            query_params: Vec::new(),
            body: None,
            response_status: ctx.response_status,
            response_status_text: ctx.response_status_text,
            response_headers: ctx.response_headers,
            response_body: ctx.response_body,
            response_time_ms: ctx.response_time_ms,
            response_size_bytes: ctx.response_size_bytes,
            environment_variables: ctx.environment_variables,
            variables: HashMap::new(),
            modified_environment_variables: HashMap::new(),
            unset_environment_variables: Vec::new(),
            console_output: Vec::new(),
            has_response_object: true,
        }
    }

    fn key_values(&self, collection: KeyValueCollection) -> &Vec<KeyValue> {
        match collection {
            KeyValueCollection::Headers => &self.headers,
            KeyValueCollection::QueryParams => &self.query_params,
        }
    }

    fn key_values_mut(&mut self, collection: KeyValueCollection) -> &mut Vec<KeyValue> {
        match collection {
            KeyValueCollection::Headers => &mut self.headers,
            KeyValueCollection::QueryParams => &mut self.query_params,
        }
    }

    fn key_value_lookup(&self, collection: KeyValueCollection, key: &str) -> Option<String> {
        self.key_values(collection)
            .iter()
            .find(|item| item.key.eq_ignore_ascii_case(key) && item.enabled)
            .map(|item| item.value.clone())
    }

    fn key_value_add(&mut self, collection: KeyValueCollection, key: String, value: String) {
        self.key_values_mut(collection).push(KeyValue {
            key,
            value,
            enabled: true,
        });
    }

    fn key_value_upsert(&mut self, collection: KeyValueCollection, key: String, value: String) {
        if let Some(entry) = self
            .key_values_mut(collection)
            .iter_mut()
            .find(|item| item.key.eq_ignore_ascii_case(&key))
        {
            entry.value = value;
            entry.enabled = true;
            return;
        }

        self.key_value_add(collection, key, value);
    }

    fn key_value_remove(&mut self, collection: KeyValueCollection, key: &str) {
        self.key_values_mut(collection)
            .retain(|item| !item.key.eq_ignore_ascii_case(key));
    }

    fn env_scope(&self, scope: EnvironmentScope) -> &HashMap<String, String> {
        match scope {
            EnvironmentScope::Environment => &self.environment_variables,
            EnvironmentScope::Variables => &self.variables,
        }
    }

    fn env_scope_mut(&mut self, scope: EnvironmentScope) -> &mut HashMap<String, String> {
        match scope {
            EnvironmentScope::Environment => &mut self.environment_variables,
            EnvironmentScope::Variables => &mut self.variables,
        }
    }

    fn set_environment(&mut self, key: String, value: String) {
        self.environment_variables
            .insert(key.clone(), value.clone());
        self.modified_environment_variables
            .insert(key.clone(), value);
        self.unset_environment_variables.retain(|item| item != &key);
    }

    fn unset_environment(&mut self, key: String) {
        self.environment_variables.remove(&key);
        self.modified_environment_variables.remove(&key);
        if !self
            .unset_environment_variables
            .iter()
            .any(|item| item == &key)
        {
            self.unset_environment_variables.push(key);
        }
    }

    fn to_pre_request_context(&self, body_type: String) -> PreRequestScriptContext {
        PreRequestScriptContext {
            method: self.method.clone(),
            url: self.url.clone(),
            headers: self.headers.clone(),
            query_params: self.query_params.clone(),
            body: self.body.clone(),
            body_type,
            environment_variables: self.environment_variables.clone(),
            local_variables: self.variables.clone(),
            request_name: self.request_name.clone(),
        }
    }

    fn to_post_response_context(&self) -> PostResponseScriptContext {
        PostResponseScriptContext {
            method: self.method.clone(),
            url: self.url.clone(),
            request_headers: self.headers.clone(),
            response_status: self.response_status,
            response_status_text: self.response_status_text.clone(),
            response_headers: self.response_headers.clone(),
            response_body: self.response_body.clone(),
            response_time_ms: self.response_time_ms,
            response_size_bytes: self.response_size_bytes,
            environment_variables: self.environment_variables.clone(),
            request_name: self.request_name.clone(),
        }
    }

    fn modified_environment_as_key_values(&self) -> Vec<KeyValue> {
        self.modified_environment_variables
            .iter()
            .map(|(key, value)| KeyValue {
                key: key.clone(),
                value: value.clone(),
                enabled: true,
            })
            .collect()
    }
}

// ---------- Helpers ----------

fn js_str(value: &str) -> JsString {
    JsString::from(value)
}

fn arg_to_string(args: &[JsValue], index: usize, context: &mut Context) -> JsResult<String> {
    let value = args.get(index).cloned().unwrap_or(JsValue::undefined());
    value
        .to_string(context)
        .map(|value| value.to_std_string_escaped())
}

fn arg_to_option_string(
    args: &[JsValue],
    index: usize,
    context: &mut Context,
) -> JsResult<Option<String>> {
    let value = args.get(index).cloned().unwrap_or(JsValue::undefined());
    if value.is_undefined() || value.is_null() {
        return Ok(None);
    }
    let s = value.to_string(context)?.to_std_string_escaped();
    Ok(Some(s))
}

fn key_value_to_js_object(values: &[KeyValue], context: &mut Context) -> JsResult<JsObject> {
    let object = JsObject::with_object_proto(context.intrinsics());
    for entry in values.iter().filter(|entry| entry.enabled) {
        object.create_data_property_or_throw(
            js_str(&entry.key),
            JsValue::from(js_str(&entry.value)),
            context,
        )?;
    }
    Ok(object)
}

fn string_map_to_js_object(
    values: &HashMap<String, String>,
    context: &mut Context,
) -> JsResult<JsObject> {
    let object = JsObject::with_object_proto(context.intrinsics());
    for (key, value) in values.iter() {
        object.create_data_property_or_throw(js_str(key), JsValue::from(js_str(value)), context)?;
    }
    Ok(object)
}

/// Build a `NativeFunction` from a closure that captures non-`Copy` state.
///
/// SAFETY: Captured state (`Rc<RefCell<ScriptState>>`) holds no traceable GC
/// objects — it only references plain Rust data. See module-level comment.
unsafe fn make_native<F>(f: F) -> NativeFunction
where
    F: Fn(&JsValue, &[JsValue], &mut Context) -> JsResult<JsValue> + 'static,
{
    unsafe { NativeFunction::from_closure(f) }
}

// ---------- Console ----------

fn append_console_entry(
    state: &Rc<RefCell<ScriptState>>,
    level: &str,
    args: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    let rendered = args
        .iter()
        .map(|value| value.to_string(context).map(|v| v.to_std_string_escaped()))
        .collect::<Result<Vec<_>, _>>()?
        .join(" ");

    let phase = state.borrow().phase.to_string();
    state.borrow_mut().console_output.push(ScriptConsoleEntry {
        level: level.to_string(),
        message: rendered,
        phase,
    });

    Ok(JsValue::undefined())
}

fn build_console_api(context: &mut Context, state: Rc<RefCell<ScriptState>>) -> JsResult<JsObject> {
    let make_method = |state: Rc<RefCell<ScriptState>>, level: &'static str| -> NativeFunction {
        unsafe {
            make_native(move |_, args, context| append_console_entry(&state, level, args, context))
        }
    };

    let mut init = ObjectInitializer::new(context);
    init.function(make_method(state.clone(), "log"), js_string!("log"), 0);
    init.function(make_method(state.clone(), "warn"), js_string!("warn"), 0);
    init.function(make_method(state.clone(), "error"), js_string!("error"), 0);
    init.function(make_method(state.clone(), "info"), js_string!("info"), 0);
    init.function(make_method(state, "debug"), js_string!("debug"), 0);
    Ok(init.build())
}

// ---------- Headers / Query Params ----------

fn build_key_value_collection_api(
    context: &mut Context,
    state: Rc<RefCell<ScriptState>>,
    collection: KeyValueCollection,
) -> JsResult<JsObject> {
    let get_fn = {
        let state = state.clone();
        unsafe {
            make_native(move |_, args, context| {
                let key = arg_to_string(args, 0, context)?;
                let value = state.borrow().key_value_lookup(collection, &key);
                Ok(value.map_or(JsValue::null(), |v| JsValue::from(js_str(&v))))
            })
        }
    };
    let add_fn = {
        let state = state.clone();
        unsafe {
            make_native(move |_, args, context| {
                let key = arg_to_string(args, 0, context)?;
                let value = arg_to_string(args, 1, context)?;
                state.borrow_mut().key_value_add(collection, key, value);
                Ok(JsValue::undefined())
            })
        }
    };
    let upsert_fn = {
        let state = state.clone();
        unsafe {
            make_native(move |_, args, context| {
                let key = arg_to_string(args, 0, context)?;
                let value = arg_to_string(args, 1, context)?;
                state.borrow_mut().key_value_upsert(collection, key, value);
                Ok(JsValue::undefined())
            })
        }
    };
    let remove_fn = {
        let state = state.clone();
        unsafe {
            make_native(move |_, args, context| {
                let key = arg_to_string(args, 0, context)?;
                state.borrow_mut().key_value_remove(collection, &key);
                Ok(JsValue::undefined())
            })
        }
    };
    let to_object_fn = {
        let state = state.clone();
        unsafe {
            make_native(move |_, _args, context| {
                let values = state.borrow().key_values(collection).clone();
                key_value_to_js_object(&values, context).map(JsValue::from)
            })
        }
    };

    let mut init = ObjectInitializer::new(context);
    init.function(get_fn, js_string!("get"), 1);
    init.function(add_fn, js_string!("add"), 2);
    init.function(upsert_fn, js_string!("upsert"), 2);
    init.function(remove_fn, js_string!("remove"), 1);
    init.function(to_object_fn, js_string!("toObject"), 0);
    Ok(init.build())
}

// ---------- Environment / Variables ----------

fn build_environment_api(
    context: &mut Context,
    state: Rc<RefCell<ScriptState>>,
    scope: EnvironmentScope,
) -> JsResult<JsObject> {
    let get_fn = {
        let state = state.clone();
        unsafe {
            make_native(move |_, args, context| {
                let key = arg_to_string(args, 0, context)?;
                let value = state.borrow().env_scope(scope).get(&key).cloned();
                Ok(value.map_or(JsValue::null(), |v| JsValue::from(js_str(&v))))
            })
        }
    };
    let set_fn = {
        let state = state.clone();
        unsafe {
            make_native(move |_, args, context| {
                let key = arg_to_string(args, 0, context)?;
                let value = arg_to_option_string(args, 1, context)?.unwrap_or_default();
                match scope {
                    EnvironmentScope::Environment => state.borrow_mut().set_environment(key, value),
                    EnvironmentScope::Variables => {
                        state
                            .borrow_mut()
                            .env_scope_mut(EnvironmentScope::Variables)
                            .insert(key, value);
                    }
                }
                Ok(JsValue::undefined())
            })
        }
    };
    let has_fn = {
        let state = state.clone();
        unsafe {
            make_native(move |_, args, context| {
                let key = arg_to_string(args, 0, context)?;
                Ok(JsValue::from(
                    state.borrow().env_scope(scope).contains_key(&key),
                ))
            })
        }
    };
    let unset_fn = {
        let state = state.clone();
        unsafe {
            make_native(move |_, args, context| {
                let key = arg_to_string(args, 0, context)?;
                match scope {
                    EnvironmentScope::Environment => state.borrow_mut().unset_environment(key),
                    EnvironmentScope::Variables => {
                        state
                            .borrow_mut()
                            .env_scope_mut(EnvironmentScope::Variables)
                            .remove(&key);
                    }
                }
                Ok(JsValue::undefined())
            })
        }
    };
    let to_object_fn = {
        let state = state.clone();
        unsafe {
            make_native(move |_, _args, context| {
                let values = state.borrow().env_scope(scope).clone();
                string_map_to_js_object(&values, context).map(JsValue::from)
            })
        }
    };

    let mut init = ObjectInitializer::new(context);
    init.function(get_fn, js_string!("get"), 1);
    init.function(set_fn, js_string!("set"), 2);
    init.function(has_fn, js_string!("has"), 1);
    init.function(unset_fn, js_string!("unset"), 1);
    init.function(to_object_fn, js_string!("toObject"), 0);
    Ok(init.build())
}

// ---------- Request ----------

fn build_request_api(context: &mut Context, state: Rc<RefCell<ScriptState>>) -> JsResult<JsObject> {
    // Accessors are implemented via JsFunction getters/setters.
    let method_getter = {
        let state = state.clone();
        let f = unsafe {
            make_native(move |_, _, _| Ok(JsValue::from(js_str(&state.borrow().method))))
        };
        FunctionObjectBuilder::new(context.realm(), f)
            .name(js_string!("get method"))
            .length(0)
            .build()
    };
    let method_setter = {
        let state = state.clone();
        let f = unsafe {
            make_native(move |_, args, context| {
                let value = arg_to_string(args, 0, context)?;
                state.borrow_mut().method = value;
                Ok(JsValue::undefined())
            })
        };
        FunctionObjectBuilder::new(context.realm(), f)
            .name(js_string!("set method"))
            .length(1)
            .build()
    };

    let url_getter = {
        let state = state.clone();
        let f =
            unsafe { make_native(move |_, _, _| Ok(JsValue::from(js_str(&state.borrow().url)))) };
        FunctionObjectBuilder::new(context.realm(), f)
            .name(js_string!("get url"))
            .length(0)
            .build()
    };
    let url_setter = {
        let state = state.clone();
        let f = unsafe {
            make_native(move |_, args, context| {
                let value = arg_to_string(args, 0, context)?;
                state.borrow_mut().url = value;
                Ok(JsValue::undefined())
            })
        };
        FunctionObjectBuilder::new(context.realm(), f)
            .name(js_string!("set url"))
            .length(1)
            .build()
    };

    let body_getter = {
        let state = state.clone();
        let f = unsafe {
            make_native(move |_, _, _| {
                let value = state.borrow().body.clone();
                Ok(value.map_or(JsValue::null(), |v| JsValue::from(js_str(&v))))
            })
        };
        FunctionObjectBuilder::new(context.realm(), f)
            .name(js_string!("get body"))
            .length(0)
            .build()
    };
    let body_setter = {
        let state = state.clone();
        let f = unsafe {
            make_native(move |_, args, context| {
                let value = arg_to_option_string(args, 0, context)?;
                state.borrow_mut().body = value;
                Ok(JsValue::undefined())
            })
        };
        FunctionObjectBuilder::new(context.realm(), f)
            .name(js_string!("set body"))
            .length(1)
            .build()
    };

    let headers =
        build_key_value_collection_api(context, state.clone(), KeyValueCollection::Headers)?;
    let query =
        build_key_value_collection_api(context, state.clone(), KeyValueCollection::QueryParams)?;

    let mut init = ObjectInitializer::new(context);
    init.accessor(
        js_string!("method"),
        Some(method_getter),
        Some(method_setter),
        Attribute::all(),
    );
    init.accessor(
        js_string!("url"),
        Some(url_getter),
        Some(url_setter),
        Attribute::all(),
    );
    init.accessor(
        js_string!("body"),
        Some(body_getter),
        Some(body_setter),
        Attribute::all(),
    );
    init.property(js_string!("headers"), headers, Attribute::all());
    init.property(js_string!("queryParams"), query, Attribute::all());
    Ok(init.build())
}

// ---------- Response ----------

fn build_response_api(
    context: &mut Context,
    state: Rc<RefCell<ScriptState>>,
) -> JsResult<JsObject> {
    // Capture response data up-front — the response is immutable inside the script.
    let (code, status_text, response_time, response_size, response_body, response_headers) = {
        let s = state.borrow();
        (
            s.response_status,
            s.response_status_text.clone(),
            s.response_time_ms,
            s.response_size_bytes,
            s.response_body.clone(),
            s.response_headers.clone(),
        )
    };

    // Build a nested headers object.
    let headers_obj = {
        let headers_for_get = response_headers.clone();
        let get_fn = unsafe {
            make_native(move |_, args, context| {
                let key = arg_to_string(args, 0, context)?;
                let value = headers_for_get
                    .iter()
                    .find(|item| item.key.eq_ignore_ascii_case(&key) && item.enabled)
                    .map(|item| item.value.clone());
                Ok(value.map_or(JsValue::null(), |v| JsValue::from(js_str(&v))))
            })
        };
        let headers_for_obj = response_headers.clone();
        let to_object_fn = unsafe {
            make_native(move |_, _args, context| {
                key_value_to_js_object(&headers_for_obj, context).map(JsValue::from)
            })
        };
        let mut init = ObjectInitializer::new(context);
        init.function(get_fn, js_string!("get"), 1);
        init.function(to_object_fn, js_string!("toObject"), 0);
        init.build()
    };

    let text_fn = {
        let body = response_body.clone();
        unsafe { make_native(move |_, _args, _context| Ok(JsValue::from(js_str(&body)))) }
    };

    let json_fn = {
        let body = response_body.clone();
        unsafe {
            make_native(move |_, _args, context| {
                // Parse the response body via JSON.parse. We pass the body as a
                // JSON-encoded string literal so JSON.parse gets a valid argument.
                let encoded = serde_json::to_string(&body).map_err(|e| {
                    JsError::from(
                        JsNativeError::typ().with_message(format!("failed to encode body: {e}")),
                    )
                })?;
                let src = format!("JSON.parse({encoded})");
                context.eval(Source::from_bytes(&src))
            })
        }
    };

    let mut init = ObjectInitializer::new(context);
    init.property(js_string!("code"), JsValue::from(code), Attribute::all());
    init.property(
        js_string!("status"),
        JsValue::from(js_str(&status_text)),
        Attribute::all(),
    );
    init.property(
        js_string!("responseTime"),
        JsValue::from(response_time),
        Attribute::all(),
    );
    init.property(
        js_string!("responseSize"),
        JsValue::from(response_size),
        Attribute::all(),
    );
    init.property(js_string!("headers"), headers_obj, Attribute::all());
    init.function(text_fn, js_string!("text"), 0);
    init.function(json_fn, js_string!("json"), 0);
    Ok(init.build())
}

// ---------- Info ----------

fn build_info_api(context: &mut Context, state: Rc<RefCell<ScriptState>>) -> JsResult<JsObject> {
    let (event_name, request_name) = {
        let s = state.borrow();
        (
            JsValue::from(js_str(s.phase)),
            s.request_name
                .as_deref()
                .map_or(JsValue::null(), |v| JsValue::from(js_str(v))),
        )
    };
    let mut init = ObjectInitializer::new(context);
    init.property(js_string!("eventName"), event_name, Attribute::all());
    init.property(js_string!("requestName"), request_name, Attribute::all());
    Ok(init.build())
}

// ---------- Top-level alloy ----------

fn setup_alloy_api(context: &mut Context, state: Rc<RefCell<ScriptState>>) -> JsResult<()> {
    let request = build_request_api(context, state.clone())?;
    let environment = build_environment_api(context, state.clone(), EnvironmentScope::Environment)?;
    let variables = build_environment_api(context, state.clone(), EnvironmentScope::Variables)?;
    let console = build_console_api(context, state.clone())?;
    let info = build_info_api(context, state.clone())?;
    let response = if state.borrow().has_response_object {
        Some(build_response_api(context, state.clone())?)
    } else {
        None
    };

    let alloy = {
        let mut init = ObjectInitializer::new(context);
        init.property(js_string!("request"), request, Attribute::all());
        init.property(js_string!("environment"), environment, Attribute::all());
        init.property(js_string!("variables"), variables, Attribute::all());
        init.property(js_string!("console"), console, Attribute::all());
        init.property(js_string!("info"), info, Attribute::all());
        if let Some(response) = response {
            init.property(js_string!("response"), response, Attribute::all());
        }
        init.build()
    };

    context.register_global_property(js_string!("alloy"), alloy, Attribute::all())?;

    // Also expose a top-level `console` that proxies to `alloy.console` so users
    // can use the familiar `console.log(...)` without prefixing.
    context
        .eval(Source::from_bytes("var console = alloy.console;"))
        .map(|_| ())
}

fn build_script_result(state: &ScriptState, error: Option<String>) -> ScriptResult {
    ScriptResult {
        success: error.is_none(),
        error,
        console_output: state.console_output.clone(),
        modified_environment_variables: state.modified_environment_as_key_values(),
        unset_environment_variables: state.unset_environment_variables.clone(),
    }
}

fn format_js_error(error: &JsError) -> String {
    error.to_string()
}

// ---------- Public API ----------

pub fn run_pre_request_script(
    script: &str,
    ctx: PreRequestScriptContext,
) -> (
    PreRequestScriptContext,
    PreRequestScriptMutations,
    ScriptResult,
) {
    let body_type = ctx.body_type.clone();
    let state = Rc::new(RefCell::new(ScriptState::from_pre_request(ctx)));
    let mut context = Context::default();

    let error = match setup_alloy_api(&mut context, state.clone()) {
        Ok(()) => context
            .eval(Source::from_bytes(script))
            .err()
            .map(|e| format_js_error(&e)),
        Err(e) => Some(format_js_error(&e)),
    };

    let state_ref = state.borrow();
    let output = build_script_result(&state_ref, error);
    let updated_ctx = state_ref.to_pre_request_context(body_type);
    let mutations = PreRequestScriptMutations {
        method: state_ref.method.clone(),
        url: state_ref.url.clone(),
        headers: state_ref.headers.clone(),
        query_params: state_ref.query_params.clone(),
        body: state_ref.body.clone(),
    };
    drop(state_ref);
    let _ = state; // keep Rc alive until here

    (updated_ctx, mutations, output)
}

pub fn run_post_response_script(
    script: &str,
    ctx: PostResponseScriptContext,
) -> (PostResponseScriptContext, ScriptResult) {
    let state = Rc::new(RefCell::new(ScriptState::from_post_response(ctx)));
    let mut context = Context::default();

    let error = match setup_alloy_api(&mut context, state.clone()) {
        Ok(()) => context
            .eval(Source::from_bytes(script))
            .err()
            .map(|e| format_js_error(&e)),
        Err(e) => Some(format_js_error(&e)),
    };

    let state_ref = state.borrow();
    let output = build_script_result(&state_ref, error);
    let updated_ctx = state_ref.to_post_response_context();
    drop(state_ref);
    let _ = state;

    (updated_ctx, output)
}

// Avoid dead-code warning for PropertyDescriptor import while we iterate.
#[allow(dead_code)]
fn _unused_property_descriptor() -> PropertyDescriptor {
    PropertyDescriptor::builder().build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pre_ctx() -> PreRequestScriptContext {
        PreRequestScriptContext {
            method: "GET".into(),
            url: "https://example.com/users".into(),
            headers: vec![],
            query_params: vec![],
            body: None,
            body_type: "none".into(),
            environment_variables: HashMap::new(),
            local_variables: HashMap::new(),
            request_name: Some("Test".into()),
        }
    }

    #[test]
    fn pre_request_can_modify_method_and_url() {
        let script = r#"
            alloy.request.method = "POST";
            alloy.request.url = "https://example.com/new";
            alloy.request.headers.add("X-Foo", "bar");
        "#;
        let (ctx, mutations, result) = run_pre_request_script(script, pre_ctx());
        assert!(result.success, "error: {:?}", result.error);
        assert_eq!(mutations.method, "POST");
        assert_eq!(mutations.url, "https://example.com/new");
        assert_eq!(ctx.headers.len(), 1);
        assert_eq!(mutations.headers[0].key, "X-Foo");
    }

    #[test]
    fn environment_set_is_tracked() {
        let script = r#"
            alloy.environment.set("token", "abc123");
            alloy.console.log("set token");
        "#;
        let (_ctx, _mutations, result) = run_pre_request_script(script, pre_ctx());
        assert!(result.success);
        assert_eq!(result.modified_environment_variables.len(), 1);
        assert_eq!(result.modified_environment_variables[0].key, "token");
        assert_eq!(result.modified_environment_variables[0].value, "abc123");
        assert_eq!(result.console_output.len(), 1);
    }

    #[test]
    fn response_json_parses_body() {
        let ctx = PostResponseScriptContext {
            method: "GET".into(),
            url: "https://example.com".into(),
            request_headers: vec![],
            response_status: 200,
            response_status_text: "OK".into(),
            response_headers: vec![],
            response_body: r#"{"name":"alice","id":42}"#.into(),
            response_time_ms: 10,
            response_size_bytes: 20,
            environment_variables: HashMap::new(),
            request_name: None,
        };
        let script = r#"
            var body = alloy.response.json();
            alloy.environment.set("name", body.name);
            alloy.environment.set("id", String(body.id));
        "#;
        let (_ctx, result) = run_post_response_script(script, ctx);
        assert!(result.success, "error: {:?}", result.error);
        let map: HashMap<_, _> = result
            .modified_environment_variables
            .iter()
            .map(|kv| (kv.key.clone(), kv.value.clone()))
            .collect();
        assert_eq!(map.get("name"), Some(&"alice".to_string()));
        assert_eq!(map.get("id"), Some(&"42".to_string()));
    }

    #[test]
    fn local_variables_round_trip() {
        let script = r#"
            alloy.variables.set("request_id", "xyz");
        "#;
        let (ctx, _mutations, result) = run_pre_request_script(script, pre_ctx());
        assert!(result.success, "error: {:?}", result.error);
        assert_eq!(
            ctx.local_variables.get("request_id"),
            Some(&"xyz".to_string())
        );
    }

    #[test]
    fn syntax_error_is_reported() {
        let script = "this is not valid JS ;;";
        let (_ctx, _mutations, result) = run_pre_request_script(script, pre_ctx());
        assert!(!result.success);
        assert!(result.error.is_some());
    }
}
