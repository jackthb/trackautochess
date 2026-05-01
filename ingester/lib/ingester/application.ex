defmodule Ingester.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [Ingester.Poller]
    Supervisor.start_link(children, strategy: :one_for_one, name: Ingester.Supervisor)
  end
end
