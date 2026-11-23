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
// Rendering follows a deadline accumulator; late frames never produce catch-up bursts.
export function advanceRenderDeadline(time: number, deadline: number, fps = 60) {
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
