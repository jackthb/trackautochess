/**
 * AudioWorklet processor — runs on the audio render thread.
 * Accumulates input samples into chunks and posts Float32Array buffers
 * back to the main thread for WebSocket transmission.
 *
 * The AudioContext is created at 16 kHz so no resampling is needed here.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 0.5 s of audio at 16 kHz = 8 000 samples per chunk sent to server.
    // Smaller = lower latency, larger = better Whisper context.
    this._chunkSamples = 8_000;
    this._buf = new Float32Array(this._chunkSamples);
    this._filled = 0;
  }

  process(inputs) {
    // inputs[0][0] = mono channel (we asked for mono via channelCount)
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    let offset = 0;
    while (offset < channel.length) {
      const space = this._chunkSamples - this._filled;
      const take  = Math.min(space, channel.length - offset);
      this._buf.set(channel.subarray(offset, offset + take), this._filled);
      this._filled += take;
      offset       += take;

      if (this._filled === this._chunkSamples) {
        // Transfer ownership — zero-copy
        const out = this._buf.slice();
        this.port.postMessage(out, [out.buffer]);
        this._filled = 0;
      }
    }
    return true; // keep processor alive
  }
}

registerProcessor("pcm-processor", PCMProcessor);
