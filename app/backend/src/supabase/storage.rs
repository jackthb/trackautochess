use super::{describe_ureq_error, SupabaseClient, HTTP_TIMEOUT};
use crate::config::Config;
use serde_json::Value;

impl SupabaseClient {
    pub(super) fn upload_nettable_dump_object(
        &self,
        cfg: &Config,
        object_path: &str,
        body: &[u8],
        content_type: &str,
    ) -> Result<String, String> {
        let upload_url = cfg.nettable_dump_upload_url.trim();
        if upload_url.is_empty() {
            return self.upload_storage_object(object_path, body, content_type, true);
        }

        let response = ureq::post(upload_url)
            .timeout(HTTP_TIMEOUT)
            .set("Authorization", &format!("Bearer {}", self.bearer_token()))
            .set("Content-Type", content_type)
            .set("X-DAC-Object-Path", object_path)
            .send_bytes(body);

        match response {
            Ok(resp) if (200..300).contains(&resp.status()) => {
                let body = resp.into_string().unwrap_or_default();
                Ok(serde_json::from_str::<Value>(&body)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("path")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned)
                    })
                    .unwrap_or_else(|| format!("r2/{object_path}")))
            }
            Ok(resp) => {
                let status = resp.status();
                let detail = resp.into_string().unwrap_or_default();
                if detail.trim().is_empty() {
                    Err(format!("R2 upload endpoint returned HTTP {status}"))
                } else {
                    Err(format!(
                        "R2 upload endpoint returned HTTP {status}: {detail}"
                    ))
                }
            }
            Err(err) => Err(describe_ureq_error(err)),
        }
    }

    pub(super) fn upload_storage_object(
        &self,
        object_path: &str,
        body: &[u8],
        content_type: &str,
        upsert: bool,
    ) -> Result<String, String> {
        let mut request = ureq::post(&format!(
            "{}/storage/v1/object/diagnostic-logs/{}",
            self.url, object_path
        ))
        .timeout(HTTP_TIMEOUT)
        .set("apikey", &self.key)
        .set("Authorization", &format!("Bearer {}", self.bearer_token()))
        .set("Content-Type", content_type);
        if upsert {
            request = request.set("x-upsert", "true");
        }
        match request.send_bytes(body) {
            Ok(resp) if (200..300).contains(&resp.status()) => {
                Ok(format!("diagnostic-logs/{object_path}"))
            }
            Ok(resp) => Err(format!("Supabase Storage returned HTTP {}", resp.status())),
            Err(err) => Err(err.to_string()),
        }
    }
}
