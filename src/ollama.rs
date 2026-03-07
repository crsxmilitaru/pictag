use base64::Engine;
use image::ImageFormat;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;
use std::time::Duration;

fn create_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

fn map_network_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "Request timed out. Check if Ollama is busy or increase timeout.".to_string()
    } else if e.is_connect() {
        "Could not connect to Ollama. Ensure it is running and the URL is correct.".to_string()
    } else {
        format!("Network error: {}", e)
    }
}

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    images: Vec<String>,
    stream: bool,
}

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
}

#[derive(Deserialize)]
struct Model {
    name: String,
}

#[derive(Deserialize)]
struct ModelsResponse {
    models: Vec<Model>,
}

#[derive(Serialize)]
struct ShowRequest {
    name: String,
}

#[derive(Deserialize)]
struct ShowDetails {
    #[serde(default)]
    families: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct ShowResponse {
    #[serde(default)]
    details: Option<ShowDetails>,
    #[serde(default)]
    capabilities: Option<Vec<String>>,
}

pub async fn get_available_models(ollama_url: &str) -> Result<Vec<String>, String> {
    let client = create_client();
    let response = client
        .get(format!("{}/api/tags", ollama_url))
        .send()
        .await
        .map_err(map_network_error)?;

    let models_response: ModelsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse models: {}", e))?;
    let mut vision_models = Vec::new();

    for model in models_response.models {
        let request = ShowRequest {
            name: model.name.clone(),
        };

        if let Ok(resp) = client
            .post(format!("{}/api/show", ollama_url))
            .json(&request)
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(info) = resp.json::<ShowResponse>().await {
                    let has_vision_capability = info
                        .capabilities
                        .as_ref()
                        .map(|c| c.iter().any(|s| s == "vision"))
                        .unwrap_or(false);

                    let has_vision_family = info
                        .details
                        .as_ref()
                        .and_then(|d| d.families.as_ref())
                        .map(|f| f.iter().any(|s| s == "clip" || s == "mllama"))
                        .unwrap_or(false);

                    if has_vision_capability || has_vision_family {
                        vision_models.push(model.name);
                    }
                }
            }
        }
    }

    Ok(vision_models)
}

pub async fn analyze_image(
    image_path: &Path,
    model: &str,
    ollama_url: &str,
    prompt: &str,
) -> Result<String, String> {
    let img = image::open(image_path).map_err(|e| format!("Failed to open image: {}", e))?;
    let resized = img.thumbnail(1024, 1024);
    let mut buffer = Cursor::new(Vec::new());
    resized
        .write_to(&mut buffer, ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode image: {}", e))?;
    let base64_img = base64::engine::general_purpose::STANDARD.encode(buffer.into_inner());

    let request = OllamaRequest {
        model: model.to_string(),
        prompt: prompt.to_string(),
        images: vec![base64_img],
        stream: false,
    };

    let client = create_client();
    let response = client
        .post(format!("{}/api/generate", ollama_url))
        .json(&request)
        .send()
        .await
        .map_err(map_network_error)?;

    if !response.status().is_success() {
        return Err(format!(
            "Ollama API error ({}): {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }

    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to get response text: {}", e))?;
    let ollama_response: OllamaResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let mut description: String = ollama_response
        .response
        .trim()
        .replace(
            |c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_',
            "",
        )
        .replace(' ', "_")
        .to_lowercase()
        .chars()
        .take(150)
        .collect();

    description = description
        .trim_end_matches(|c| c == '_' || c == '-')
        .to_string();

    if description.is_empty() {
        description = format!(
            "image_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        );
    }

    Ok(description)
}
