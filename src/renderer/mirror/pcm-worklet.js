// Plays the phone's sound: 16-bit stereo PCM at 48 kHz, kept to a small buffer for low delay.

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 48000; // 1 second ring buffer per channel
    this.left = new Float32Array(this.size);
    this.right = new Float32Array(this.size);
    this.read = 0;
    this.write = 0;
    this.started = false;
    this.START = 48000 * 0.04; // start once 40 ms are buffered
    this.MAX = 48000 * 0.15; // if more than 150 ms pile up…
    this.TARGET = 48000 * 0.05; // …skip ahead to 50 ms
    this.port.onmessage = (e) => this.push(e.data);
  }

  buffered() {
    return (this.write - this.read + this.size) % this.size;
  }

  push(int16) {
    for (let i = 0; i + 1 < int16.length; i += 2) {
      this.left[this.write] = int16[i] / 32768;
      this.right[this.write] = int16[i + 1] / 32768;
      this.write = (this.write + 1) % this.size;
      if (this.write === this.read) this.read = (this.read + 1) % this.size; // overflow: drop oldest
    }
    if (this.buffered() > this.MAX) this.read = (this.write - this.TARGET + this.size) % this.size;
  }

  process(_inputs, outputs) {
    const [l, r] = outputs[0];
    if (!this.started) {
      if (this.buffered() < this.START) return true;
      this.started = true;
    }
    for (let i = 0; i < l.length; i++) {
      if (this.read === this.write) {
        this.started = false; // ran dry: wait for a little buffer again
        l.fill(0, i);
        if (r) r.fill(0, i);
        break;
      }
      l[i] = this.left[this.read];
      if (r) r[i] = this.right[this.read];
      this.read = (this.read + 1) % this.size;
    }
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
