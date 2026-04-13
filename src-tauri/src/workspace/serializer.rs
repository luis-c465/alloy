use std::fmt::Write;

use crate::workspace::types::{HttpFileData, HttpFileRequest};

const FILE_BODY_PREFIX: &str = "@file:";
const SAVE_BODY_PREFIX: &str = "@save:";

pub fn serialize_http_file(data: &HttpFileData) -> String {
    let mut output = String::new();

    if !data.variables.is_empty() {
        for variable in &data.variables {
            let _ = writeln!(&mut output, "@{} = {}", variable.key, variable.value);
        }
        output.push('\n');
    }

    for (index, request) in data.requests.iter().enumerate() {
        if index > 0 {
            output.push('\n');
        }

        write_request(&mut output, request);
    }

    if !output.ends_with('\n') {
        output.push('\n');
    }

    output
}

fn write_request(output: &mut String, request: &HttpFileRequest) {
    output.push_str("###\n");

    if let Some(name) = &request.name {
        let _ = writeln!(output, "# @name {name}");
    }

    for (command, value) in &request.commands {
        if command == "name" {
            continue;
        }

        match value {
            Some(value) => {
                let _ = writeln!(output, "# @{command} {value}");
            }
            None => {
                let _ = writeln!(output, "# @{command}");
            }
        }
    }

    let _ = writeln!(output, "{} {} HTTP/1.1", request.method, request.url);

    for header in &request.headers {
        let _ = writeln!(output, "{}: {}", header.key, header.value);
    }

    output.push('\n');

    if let Some(body) = &request.body {
        write_body(output, body);
    }
}

fn write_body(output: &mut String, body: &str) {
    if let Some(filepath) = body.strip_prefix(FILE_BODY_PREFIX) {
        let _ = writeln!(output, "< {filepath}");
        return;
    }

    if let Some((filepath, text)) = body
        .strip_prefix(SAVE_BODY_PREFIX)
        .and_then(|value| value.split_once(':'))
    {
        if !text.is_empty() {
            output.push_str(text);
            output.push('\n');
            output.push('\n');
        }
        let _ = writeln!(output, ">> {filepath}");
        return;
    }

    output.push_str(body);
    output.push('\n');
}

#[cfg(test)]
mod tests {
    use crate::{
        http::types::KeyValue,
        workspace::{
            parser::parse_http_file,
            types::{HttpFileData, HttpFileRequest},
        },
    };

    use super::serialize_http_file;

    #[test]
    fn serialize_round_trip_equivalent_data() {
        let data = HttpFileData {
            path: "sample.http".to_string(),
            variables: vec![KeyValue {
                key: "base_url".to_string(),
                value: "https://example.com".to_string(),
                enabled: true,
            }],
            requests: vec![HttpFileRequest {
                name: Some("GetUsers".to_string()),
                method: "POST".to_string(),
                url: "{{base_url}}/users".to_string(),
                headers: vec![KeyValue {
                    key: "Content-Type".to_string(),
                    value: "application/json".to_string(),
                    enabled: true,
                }],
                body: Some("{\"hello\":\"world\"}".to_string()),
                body_type: "json".to_string(),
                commands: vec![("name".to_string(), Some("GetUsers".to_string()))],
            }],
        };

        let serialized = serialize_http_file(&data);
        let reparsed = parse_http_file(&serialized, &data.path).unwrap();

        assert_eq!(reparsed.variables.len(), 1);
        assert_eq!(reparsed.requests.len(), 1);
        assert_eq!(reparsed.requests[0].method, "POST");
        assert_eq!(reparsed.requests[0].url, "{{base_url}}/users");
        assert_eq!(reparsed.requests[0].headers.len(), 1);
        assert_eq!(reparsed.requests[0].headers[0].key, "Content-Type");
        assert_eq!(
            reparsed.requests[0].body,
            Some("{\"hello\":\"world\"}".to_string())
        );
    }

    #[test]
    fn serialize_load_from_file_marker_back_to_http_syntax() {
        let data = HttpFileData {
            path: "sample.http".to_string(),
            variables: vec![],
            requests: vec![HttpFileRequest {
                name: Some("LoadUsers".to_string()),
                method: "POST".to_string(),
                url: "https://example.com/users".to_string(),
                headers: vec![],
                body: Some("@file:payload.json".to_string()),
                body_type: "raw".to_string(),
                commands: vec![],
            }],
        };

        let serialized = serialize_http_file(&data);

        assert!(serialized.contains("\n< payload.json\n"));

        let reparsed = parse_http_file(&serialized, &data.path).unwrap();
        assert_eq!(
            reparsed.requests[0].body.as_deref(),
            Some("@file:payload.json")
        );
    }

    #[test]
    fn serialize_save_to_file_marker_back_to_http_syntax() {
        let data = HttpFileData {
            path: "sample.http".to_string(),
            variables: vec![],
            requests: vec![HttpFileRequest {
                name: Some("SaveUsers".to_string()),
                method: "POST".to_string(),
                url: "https://example.com/users".to_string(),
                headers: vec![KeyValue {
                    key: "Content-Type".to_string(),
                    value: "application/json".to_string(),
                    enabled: true,
                }],
                body: Some("@save:responses/users.json:{\"hello\":\"world\"}".to_string()),
                body_type: "json".to_string(),
                commands: vec![],
            }],
        };

        let serialized = serialize_http_file(&data);

        assert!(serialized.contains("{\"hello\":\"world\"}\n\n>> responses/users.json\n"));

        let reparsed = parse_http_file(&serialized, &data.path).unwrap();
        assert_eq!(
            reparsed.requests[0].body.as_deref(),
            Some("@save:responses/users.json:{\"hello\":\"world\"}")
        );
    }
}
