const FIELD = {
  width: 1280,
  height: 720,
  halfWidth: 640
};

const CONFIG = {
  fps: 60,
  broadcastHz: 30,
  roundDelayMs: 1200,
  winningScore: 7,
  playerSize: 84,
  playerRadius: 42,
  ballRadius: 18,
  moveSpeed: 470,
  dashSpeed: 980,
  dashDurationMs: 220,
  dashCooldownMs: 1150,
  hitWindowMs: 160,
  hitCooldownMs: 320,
  specialDurationMs: 1400,
  specialCooldownMs: 4500,
  hitSpeed: 620,
  softBounce: 340,
  empoweredMultiplierX: 1.85,
  empoweredMultiplierY: 1.28,
  empoweredMinSpeed: 1220,
  empoweredFireMs: 1200,
  friction: 0.9992,
  wallBounce: 0.995,
  maxBallSpeed: 1550,
  touchPaddingIdle: 10,
  touchPaddingHit: 20,
  touchPaddingSpecial: 8,
  topBoostZoneY: 150,
  topBoostPadding: 16,
  minXPadding: 14,
  minYPadding: 72,
  maxBottomPadding: 18
};

module.exports = { FIELD, CONFIG };
