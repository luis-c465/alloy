use std::collections::HashMap;

use handlebars::{Context, Handlebars, Helper, HelperResult, Output, RenderContext};

use crate::{
    error::AppError,
    http::types::{HttpRequestData, KeyValue, MultipartField, MultipartValue, RequestBody},
};

pub fn create_resolver() -> Handlebars<'static> {
    let mut hbs = Handlebars::new();
    hbs.set_strict_mode(false);

    hbs.register_helper(
        "preserve_undefined",
        Box::new(
            |helper: &Helper,
             _: &Handlebars,
             _: &Context,
             _: &mut RenderContext,
             output: &mut dyn Output|
             -> HelperResult {
                let name = helper
                    .param(0)
                    .and_then(|value| value.value().as_str())
                    .unwrap_or_else(|| helper.name());

                output.write(&format!("{{{{{name}}}}}"))?;
                Ok(())
            },
        ),
    );

    // Called by handlebars when a variable/helper cannot be resolved.
    hbs.register_helper(
        "helperMissing",
        Box::new(
            |helper: &Helper,
             _: &Handlebars,
             _: &Context,
             _: &mut RenderContext,
             output: &mut dyn Output|
             -> HelperResult {
                output.write(&format!("{{{{{}}}}}", helper.name()))?;
                Ok(())
            },
        ),
    );

    hbs
}

pub fn resolve_template(
    hbs: &Handlebars,
    template: &str,
    variables: &HashMap<String, String>,
) -> Result<String, AppError> {
    hbs.render_template(template, variables)
        .map_err(|error| AppError::ParseError(format!("Template resolution failed: {error}")))
}

pub fn resolve_request(
    hbs: &Handlebars,
    request: &HttpRequestData,
    variables: &HashMap<String, String>,
) -> Result<HttpRequestData, AppError> {
    let method = resolve_template(hbs, &request.method, variables)?;
    let url = resolve_template(hbs, &request.url, variables)?;
    let headers = resolve_key_values(hbs, &request.headers, variables)?;
    let query_params = resolve_key_values(hbs, &request.query_params, variables)?;

    let body = match &request.body {
        RequestBody::Json(content) => RequestBody::Json(resolve_template(hbs, content, variables)?),
        RequestBody::Raw {
            content,
            content_type,
        } => RequestBody::Raw {
            content: resolve_template(hbs, content, variables)?,
            content_type: resolve_template(hbs, content_type, variables)?,
        },
        RequestBody::None => RequestBody::None,
        RequestBody::FormUrlEncoded(data) => {
            RequestBody::FormUrlEncoded(resolve_key_values(hbs, data, variables)?)
        }
        RequestBody::Multipart(fields) => {
            RequestBody::Multipart(resolve_multipart_fields(hbs, fields, variables)?)
        }
    };

    Ok(HttpRequestData {
        method,
        url,
        headers,
        query_params,
        body,
        timeout_ms: request.timeout_ms,
        skip_ssl_verification: request.skip_ssl_verification,
        request_variables: request.request_variables.clone(),
        file_path: request.file_path.clone(),
        auth_type: request.auth_type.clone(),
        auth_bearer: request
            .auth_bearer
            .as_ref()
            .map(|value| resolve_template(hbs, value, variables))
            .transpose()?,
        auth_basic_username: request
            .auth_basic_username
            .as_ref()
            .map(|value| resolve_template(hbs, value, variables))
            .transpose()?,
        auth_basic_password: request
            .auth_basic_password
            .as_ref()
            .map(|value| resolve_template(hbs, value, variables))
            .transpose()?,
    })
}

fn resolve_multipart_fields(
    hbs: &Handlebars,
    fields: &[MultipartField],
    variables: &HashMap<String, String>,
) -> Result<Vec<MultipartField>, AppError> {
    fields
        .iter()
        .map(|field| {
            let key = resolve_template(hbs, &field.key, variables)?;
            let value = match &field.value {
                MultipartValue::Text(text) => {
                    MultipartValue::Text(resolve_template(hbs, text, variables)?)
                }
                // File paths are literal filesystem references — don't resolve templates.
                MultipartValue::File { .. } => field.value.clone(),
            };
            Ok(MultipartField {
                key,
                value,
                content_type: field.content_type.clone(),
                enabled: field.enabled,
            })
        })
        .collect()
}

fn resolve_key_values(
    hbs: &Handlebars,
    values: &[KeyValue],
    variables: &HashMap<String, String>,
) -> Result<Vec<KeyValue>, AppError> {
    values
        .iter()
        .map(|kv| {
            Ok(KeyValue {
                key: resolve_template(hbs, &kv.key, variables)?,
                value: resolve_template(hbs, &kv.value, variables)?,
                enabled: kv.enabled,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_template_substitutes_variables() {
        let hbs = create_resolver();
        let variables = HashMap::from([
            ("host".to_string(), "localhost".to_string()),
            ("path".to_string(), "api".to_string()),
        ]);

        let resolved = resolve_template(&hbs, "https://{{host}}/{{path}}", &variables).unwrap();
        assert_eq!(resolved, "https://localhost/api");
    }

    #[test]
    fn resolve_template_preserves_undefined_variable() {
        let hbs = create_resolver();
        let variables = HashMap::from([("host".to_string(), "localhost".to_string())]);

        let resolved = resolve_template(&hbs, "{{host}}/{{undefined}}", &variables).unwrap();
        assert_eq!(resolved, "localhost/{{undefined}}");
    }

    #[test]
    fn resolve_request_resolves_url_headers_query_and_body() {
        let hbs = create_resolver();
        let variables = HashMap::from([
            ("method".to_string(), "POST".to_string()),
            ("host".to_string(), "localhost:3000".to_string()),
            ("token".to_string(), "abc123".to_string()),
            ("id".to_string(), "42".to_string()),
            ("name".to_string(), "Alloy".to_string()),
        ]);

        let request = HttpRequestData {
            method: "{{method}}".to_string(),
            url: "https://{{host}}/users".to_string(),
            headers: vec![KeyValue {
                key: "Authorization".to_string(),
                value: "Bearer {{token}}".to_string(),
                enabled: true,
            }],
            query_params: vec![KeyValue {
                key: "id".to_string(),
                value: "{{id}}".to_string(),
                enabled: true,
            }],
            body: RequestBody::Json("{\"name\":\"{{name}}\"}".to_string()),
            timeout_ms: Some(1_500),
            skip_ssl_verification: true,
            request_variables: vec![],
            file_path: None,
            auth_type: None,
            auth_bearer: None,
            auth_basic_username: None,
            auth_basic_password: None,
        };

        let resolved = resolve_request(&hbs, &request, &variables).unwrap();

        assert_eq!(resolved.method, "POST");
        assert_eq!(resolved.url, "https://localhost:3000/users");
        assert_eq!(resolved.headers[0].value, "Bearer abc123");
        assert_eq!(resolved.query_params[0].value, "42");
        assert_eq!(resolved.timeout_ms, Some(1_500));
        assert!(resolved.skip_ssl_verification);

        match resolved.body {
            RequestBody::Json(content) => assert_eq!(content, "{\"name\":\"Alloy\"}"),
            _ => panic!("expected JSON body"),
        }
    }

    #[test]
    fn resolve_request_resolves_form_urlencoded_body() {
        let hbs = create_resolver();
        let variables = HashMap::from([("token".to_string(), "secret123".to_string())]);

        let request = HttpRequestData {
            method: "POST".to_string(),
            url: "https://example.com".to_string(),
            headers: vec![],
            query_params: vec![],
            body: RequestBody::FormUrlEncoded(vec![KeyValue {
                key: "api_key".to_string(),
                value: "{{token}}".to_string(),
                enabled: true,
            }]),
            timeout_ms: None,
            skip_ssl_verification: false,
            request_variables: vec![],
            file_path: None,
            auth_type: None,
            auth_bearer: None,
            auth_basic_username: None,
            auth_basic_password: None,
        };

        let resolved = resolve_request(&hbs, &request, &variables).unwrap();
        match resolved.body {
            RequestBody::FormUrlEncoded(data) => {
                assert_eq!(data[0].value, "secret123");
            }
            _ => panic!("expected FormUrlEncoded body"),
        }
    }

    #[test]
    fn resolve_request_resolves_multipart_text_fields() {
        let hbs = create_resolver();
        let variables = HashMap::from([("greeting".to_string(), "hello world".to_string())]);

        let request = HttpRequestData {
            method: "POST".to_string(),
            url: "https://example.com".to_string(),
            headers: vec![],
            query_params: vec![],
            body: RequestBody::Multipart(vec![
                MultipartField {
                    key: "message".to_string(),
                    value: MultipartValue::Text("{{greeting}}".to_string()),
                    content_type: None,
                    enabled: true,
                },
                MultipartField {
                    key: "file".to_string(),
                    value: MultipartValue::File {
                        path: "/tmp/{{greeting}}.txt".to_string(),
                        filename: None,
                    },
                    content_type: None,
                    enabled: true,
                },
            ]),
            timeout_ms: None,
            skip_ssl_verification: false,
            request_variables: vec![],
            file_path: None,
            auth_type: None,
            auth_bearer: None,
            auth_basic_username: None,
            auth_basic_password: None,
        };

        let resolved = resolve_request(&hbs, &request, &variables).unwrap();
        match resolved.body {
            RequestBody::Multipart(fields) => {
                // Text field should be resolved.
                match &fields[0].value {
                    MultipartValue::Text(text) => assert_eq!(text, "hello world"),
                    _ => panic!("expected text field"),
                }
                // File path should NOT be resolved (literal filesystem path).
                match &fields[1].value {
                    MultipartValue::File { path, .. } => {
                        assert_eq!(path, "/tmp/{{greeting}}.txt")
                    }
                    _ => panic!("expected file field"),
                }
            }
            _ => panic!("expected Multipart body"),
        }
    }

    #[test]
    fn resolve_template_invalid_syntax_returns_app_error() {
        let hbs = create_resolver();
        let variables = HashMap::new();
        let err = resolve_template(&hbs, "{{", &variables).unwrap_err();

        match err {
            AppError::ParseError(message) => {
                assert!(!message.is_empty());
            }
            _ => panic!("expected parse error"),
        }
    }

    #[test]
    fn preserve_undefined_helper_can_be_called_explicitly() {
        let hbs = create_resolver();
        let variables = HashMap::new();

        let resolved =
            resolve_template(&hbs, "{{preserve_undefined \"missing_key\"}}", &variables).unwrap();
        assert_eq!(resolved, "{{missing_key}}");
    }
}
