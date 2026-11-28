// LOGIC — exact elapsed-time response/friction, independent of Pixi and DOM.
const FRICTION = 0.25,
  RESPONSE = 0.012,
  GAIN = 1.5,
  MAX_SPEED = 9000,
  STOP_SPEED = 5;
const validSpeed = (speed: number) =>
  Number.isFinite(speed) && speed >= 0.1 && speed <= 10 ? speed : 1;
export const clampMomentum = (value: number, speed = 1) =>
  Number.isFinite(value)
    ? Math.max(-MAX_SPEED * validSpeed(speed), Math.min(MAX_SPEED * validSpeed(speed), value))
    : 0;
export const momentumImpulse = (distance: number, speed = 1) =>
  clampMomentum((distance * GAIN) / FRICTION, speed);
export function advanceMomentum(velocity: number, target: number, elapsed: number, speed = 1) {
  speed = validSpeed(speed);
  velocity = clampMomentum(velocity, speed);
  target = clampMomentum(target, speed);
  const seconds = Number.isFinite(elapsed) ? Math.max(0, Math.min(0.05, elapsed)) : 0;
  const friction = Math.exp(-seconds / FRICTION),
    response = Math.exp(-seconds / RESPONSE);
  const weight = FRICTION / (FRICTION - RESPONSE);
  const distance =
    velocity * RESPONSE * (1 - response) +
    target * weight * (FRICTION * (1 - friction) - RESPONSE * (1 - response));
  const nextVelocity = clampMomentum(
    velocity * response + target * weight * (friction - response),
    speed,
  );
  const nextTarget = clampMomentum(target * friction, speed);
  const moving =
    Math.abs(nextVelocity) >= STOP_SPEED * speed || Math.abs(nextTarget) >= STOP_SPEED * speed;
  return { distance, velocity: moving ? nextVelocity : 0, target: moving ? nextTarget : 0, moving };
}

// CONNECTED WHEEL — distance credit preserves sensitivity, rate estimation removes notch impulses.
export interface WheelGesture {
  velocity: number;
  remaining: number;
  rate: number;
  lastTick: number | null;
}
export const createWheelGesture = (): WheelGesture => ({
  velocity: 0,
  remaining: 0,
  rate: 0,
  lastTick: null,
});
const creditLimit = (value: number, speed: number, duration: number) =>
  clampMomentum(value / duration, speed) * duration;
export function appendWheelTick(
  state: WheelGesture,
  distance: number,
  time: number,
  speed = 1,
  windowMs: number,
  smoothDurationMs: number,
  momentumDurationMs: number,
) {
  if (!Number.isFinite(distance) || !distance || !Number.isFinite(time)) return state;
  const duration = Math.max(0.1, Math.min(2, smoothDurationMs / 1000));
  const direction = Math.sign(distance),
    sameDirection = direction === Math.sign(state.rate);
  const gap = state.lastTick === null ? Infinity : Math.max(0, time - state.lastTick);
  const joined = sameDirection && gap <= windowMs;
  const expired =
    state.lastTick !== null &&
    gap > Math.max(100, Math.min(2000, momentumDurationMs ?? smoothDurationMs));
  const sample = clampMomentum((distance * GAIN) / Math.max(0.016, gap / 1000), speed);
  const rate = joined
    ? state.rate + (sample - state.rate) * 0.5
    : clampMomentum((distance * GAIN) / duration, speed);
  return {
    velocity: expired ? 0 : clampMomentum(state.velocity, speed),
    remaining: creditLimit(
      expired ? distance * GAIN : (sameDirection ? state.remaining : 0) + distance * GAIN,
      speed,
      duration,
    ),
    rate: clampMomentum(rate, speed),
    lastTick: Math.max(time, state.lastTick ?? time),
  };
}
export function scaleWheelGesture(
  state: WheelGesture,
  factor: number,
  speed: number,
  smoothDurationMs: number,
): WheelGesture {
  const duration = Math.max(0.1, Math.min(2, smoothDurationMs / 1000));
  return {
    ...state,
    velocity: clampMomentum(state.velocity * factor, speed),
    remaining: creditLimit(state.remaining * factor, speed, duration),
    rate: clampMomentum(state.rate * factor, speed),
  };
}
export function scaleWheelDuration(
  state: WheelGesture,
  previousSmoothMs: number,
  nextSmoothMs: number,
  speed = 1,
): WheelGesture {
  const previous = Math.max(0.1, Math.min(2, previousSmoothMs / 1000)),
    next = Math.max(0.1, Math.min(2, nextSmoothMs / 1000)),
    factor = previous / next;
  return {
    ...state,
    velocity: clampMomentum(state.velocity * factor, speed),
    remaining: creditLimit(state.remaining, speed, next),
    rate: clampMomentum(state.rate * factor, speed),
  };
}
export function advanceWheelGesture(
  state: WheelGesture,
  elapsed: number,
  now: number,
  speed = 1,
  windowMs: number,
  smoothDurationMs: number,
  momentumDurationMs: number,
) {
  speed = validSpeed(speed);
  const duration = Math.max(0.1, Math.min(2, smoothDurationMs / 1000));
  // Momentum only paces the stopping tail: the same remaining credit is spread over the
  // configured window, so a shorter setting stops sooner without changing total travel.
  const coast = Math.max(0.1, Math.min(2, (momentumDurationMs ?? smoothDurationMs) / 1000));
  const seconds = Number.isFinite(elapsed) ? Math.max(0, Math.min(0.05, elapsed)) : 0;
  let velocity = clampMomentum(state.velocity, speed),
    remaining = creditLimit(state.remaining, speed, duration),
    distance = 0;
  const steps = Math.max(1, Math.ceil(seconds / 0.004)),
    step = seconds / steps;
  for (let n = 0; n < steps; n++) {
    const at = now - (seconds - (n + 1) * step) * 1000;
    const joined = state.lastTick !== null && at - state.lastTick <= windowMs;
    const direction = Math.sign(remaining);
    const target = joined
      ? direction * Math.min(Math.abs(state.rate), Math.abs(remaining) / (duration * 0.8))
      : remaining / coast;
    // Opposing input brakes promptly; same-direction changes blend over 40 ms.
    const response = velocity * target < 0 ? 0.02 : 0.04;
    const decay = Math.exp(-step / response);
    let travel = target * step + (velocity - target) * response * (1 - decay);
    velocity = clampMomentum(target + (velocity - target) * decay, speed);
    if (travel * remaining > 0 && Math.abs(travel) > Math.abs(remaining)) {
      travel = remaining;
      velocity = 0;
    }
    remaining -= travel;
    distance += travel;
  }
  const moving = Math.abs(remaining) >= speed || Math.abs(velocity) >= STOP_SPEED * speed;
  return {
    distance,
    moving,
    state: moving ? { ...state, velocity, remaining } : createWheelGesture(),
  };
}
// Rendering follows a deadline accumulator; late frames never produce catch-up bursts.
export function advanceRenderDeadline(time: number, deadline: number, fps = 0) {
  if (fps === 0) return { ready: true, deadline: 0 };
  const interval = 1000 / fps;
  if (time + 0.01 < deadline) return { ready: false, deadline };
  return {
    ready: true,
    deadline:
      deadline <= 0
        ? time + interval
        : deadline + (Math.floor(Math.max(0, time - deadline) / interval) + 1) * interval,
  };
}
export const tileInViewport = (
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 0,
) =>
  left + width > -margin &&
  left < viewportWidth + margin &&
  top + height > -margin &&
  top < viewportHeight + margin;

// Keep raster boundaries on the viewport's physical-pixel grid, including one sampling pixel.
// The logical viewport/column stay unchanged; only empty horizontal canvas margins disappear.
export function horizontalRenderSpan(
  viewportWidth: number,
  ratio: number,
  left: number,
  width: number,
) {
  const pixels = Math.max(1, Math.round(viewportWidth * ratio));
  const start = Math.max(0, Math.min(pixels - 1, Math.floor(left * ratio) - 1));
  const end = Math.max(start + 1, Math.min(pixels, Math.ceil((left + width) * ratio) + 1));
  return { left: start / ratio, width: (end - start) / ratio };
}
export const tileWorkNeeded = (priority: number, currentlyVisible: boolean) =>
  currentlyVisible || (priority >= 0 && priority < 5);
