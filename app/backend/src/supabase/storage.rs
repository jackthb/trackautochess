use super::{SupabaseClient, HTTP_TIMEOUT};

impl SupabaseClient {
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
        .set("Authorization", &format!("Bearer {}", self.key))
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
