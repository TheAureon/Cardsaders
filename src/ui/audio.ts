/** Tiny synthesized sound effects so the game ships with no audio assets. */
export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;

  private get ac(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol = 0.15, slide = 0) {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  private noise(dur: number, vol = 0.2, cutoff = 1200) {
    const ac = this.ac;
    if (!ac) return;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ac.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start();
  }

  whoosh() {
    this.noise(0.08, 0.06, 2500);
  }
  hit(big: boolean, vol = 1) {
    this.noise(big ? 0.25 : 0.12, (big ? 0.5 : 0.35) * vol, big ? 700 : 1100);
    this.tone(big ? 90 : 150, 0.15, 'square', 0.1 * vol, -70);
  }
  finisher(vol = 1) {
    this.noise(0.45, 0.7 * vol, 500);
    this.tone(70, 0.5, 'sawtooth', 0.16 * vol, -40);
    this.tone(1400, 0.12, 'square', 0.05 * vol, -900);
  }
  slam(vol = 1) {
    this.noise(0.35, 0.5 * vol, 300);
    this.tone(55, 0.35, 'sine', 0.2 * vol, -20);
  }
  dash() {
    this.noise(0.18, 0.18, 3000);
  }
  jump() {
    this.tone(260, 0.12, 'triangle', 0.06, 200);
  }
  card() {
    this.tone(660, 0.08, 'triangle', 0.12, 220);
  }
  block() {
    this.tone(1200, 0.2, 'sine', 0.1, -200);
    this.tone(1800, 0.15, 'sine', 0.06);
  }
  reverse() {
    this.tone(300, 0.25, 'sawtooth', 0.06, 600);
  }
  warning() {
    this.tone(880, 0.12, 'square', 0.08);
    setTimeout(() => this.tone(880, 0.12, 'square', 0.08), 160);
  }
  bad() {
    this.tone(220, 0.3, 'sawtooth', 0.08, -120);
  }
  bell() {
    this.tone(523, 0.6, 'triangle', 0.12);
    this.tone(784, 0.6, 'triangle', 0.08);
  }
  ko() {
    this.tone(400, 0.6, 'sawtooth', 0.1, -340);
  }
}
