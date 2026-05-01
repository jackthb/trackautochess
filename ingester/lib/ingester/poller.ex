defmodule Ingester.Poller do
  use GenServer
  require Logger

  @lineup_url "http://autochess.ppbizon.com/lineup/get"
  @difficulty 2

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  @impl true
  def init(_) do
    Logger.info("Poller starting")
    send(self(), :poll)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:poll, state) do
    poll_interval = Application.fetch_env!(:ingester, :poll_interval_ms)

    case fetch_lineups() do
      {:ok, entries} ->
        {inserted, skipped} = upsert_entries(entries)
        Logger.info("Poll complete — inserted: #{inserted}, skipped: #{skipped}")

      {:error, reason} ->
        Logger.error("Poll failed: #{inspect(reason)}")
    end

    Process.send_after(self(), :poll, poll_interval)
    {:noreply, state}
  end

  defp fetch_lineups do
    url = "#{@lineup_url}?difficulty=#{@difficulty}&hehe=#{:rand.uniform(10_000)}"

    case Req.get(url) do
      {:ok, %{status: 200, body: body}} ->
        case Jason.decode(body) do
          {:ok, %{"err" => 0, "data" => data}} ->
            entries =
              data
              |> Enum.flat_map(fn {_round, entries} -> entries || [] end)
              |> Enum.map(&Jason.decode!/1)

            {:ok, entries}

          {:ok, resp} ->
            {:error, "API error: #{inspect(resp)}"}

          {:error, _} ->
            {:error, "JSON decode failed"}
        end

      {:ok, %{status: status}} ->
        {:error, "HTTP #{status}"}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp upsert_entries(entries) do
    supabase_url = Application.fetch_env!(:ingester, :supabase_url)
    supabase_key = Application.fetch_env!(:ingester, :supabase_key)

    Enum.reduce(entries, {0, 0}, fn entry, {ins, skip} ->
      hash = :crypto.hash(:sha256, Jason.encode!(entry)) |> Base.hex_encode32(case: :lower)

      row = %{
        owner: entry["owner"],
        round: entry["round"],
        result: entry["result"],
        population: entry["population"],
        chess: entry["chess"],
        synergy: entry["synergy"] || "",
        talent: entry["talent"] || "",
        lineup: entry["lineup"],
        courier: entry["courier"] || entry["zhugong"],
        relic: entry["relic"] || "",
        entry_hash: hash
      }

      case Req.post("#{supabase_url}/rest/v1/lineup_snapshots",
             headers: [
               {"apikey", supabase_key},
               {"Authorization", "Bearer #{supabase_key}"},
               {"Content-Type", "application/json"},
               {"Prefer", "resolution=ignore-duplicates"}
             ],
             json: row
           ) do
        {:ok, %{status: s}} when s in [200, 201] -> {ins + 1, skip}
        {:ok, %{status: 409}} -> {ins, skip + 1}
        {:ok, %{status: s}} ->
          Logger.warning("Unexpected status #{s} for hash #{hash}")
          {ins, skip + 1}
        {:error, reason} ->
          Logger.error("Insert failed: #{inspect(reason)}")
          {ins, skip + 1}
      end
    end)
  end
end
