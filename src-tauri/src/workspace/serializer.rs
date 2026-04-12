use std::fmt::Write;

use crate::workspace::types::{HttpFileData, HttpFileRequest};

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
        output.push_str(body);
        output.push('\n');
    }
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
}
