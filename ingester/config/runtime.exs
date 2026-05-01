import Config

config :ingester,
  supabase_url: System.fetch_env!("SUPABASE_URL"),
  supabase_key: System.fetch_env!("SUPABASE_SERVICE_KEY"),
  poll_interval_ms: String.to_integer(System.get_env("POLL_INTERVAL_MS", "120000"))
