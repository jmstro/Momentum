/* TapLock - Phaser 3 (Base)
   One-tap timing loop:
   - rotating marker around ring
   - hit zone arc on ring
   - tap when marker is inside zone
   - success increases speed + shrinks zone
*/

const GAME = {
  baseSpeed: 2.4,      // radians/sec
  speedGain: 0.22,     // speed increases per score
  zoneStartSize: 0.55, // radians (~31.5 deg)
  zoneMinSize: 0.14,   // radians (~8 deg)
  zoneShrink: 0.02,    // radians per score
  grace: 0.02,         // extra radians tolerance for fairness
  interstitialEveryDeaths: 6,
  interstitialMinDeathsBeforeFirst: 2,
  interstitialMinScoreToShow: 4,
  interstitialDurationMs: 900,
  interstitialCooldownDeaths: 0,
  dailyMaxAttempts: 3
};

// Ring skins (visual only)
const SKINS = [
  { id: "default", name: "NEON BLUE", unlockScore: 0, colors: { ring: 0x142033, glow: 0x2a6bff, zone: 0x7dd3fc }, prestige: false },
  { id: "neon_pulse", name: "NEON PULSE", unlockScore: 10, colors: { ring: 0x142033, glow: 0x2a6bff, zone: 0x7dd3fc }, prestige: false },
  { id: "plasma_violet", name: "PLASMA VIOLET", unlockScore: 20, colors: { ring: 0x201032, glow: 0x7c3aed, zone: 0xff4dff }, prestige: false },
  { id: "solar_gold", name: "SOLAR GOLD", unlockScore: 30, colors: { ring: 0x2a1a08, glow: 0xff9f1a, zone: 0xffc34d }, prestige: true }
];

const RING_HOT = {
  default: 0x2a6bff,
  neon_pulse: 0x2a6bff,
  plasma_violet: 0xb026ff,
  solar_gold: 0xff9f1a
};

const GLOW_END = {
  default: 0x7dd3fc,
  neon_pulse: 0x7dd3fc,
  plasma_violet: 0xff4dff,
  solar_gold: 0xffe08a
};

const UI_FONT = '"Orbitron", "Rajdhani", "Segoe UI", system-ui, -apple-system';
const ASSET_VERSION = (typeof window !== "undefined" && window.ASSET_VERSION)
  ? window.ASSET_VERSION
  : Date.now().toString();
const assetUrl = (path) => {
  const sep = path.includes("?") ? "&" : "?";
  return path + sep + "v=" + ASSET_VERSION;
};

class TapLockScene extends Phaser.Scene {
  constructor() {
    super("TapLockScene");
    this.score = 0;
    this.best = 0;

    this.angle = 0; // marker angle
    this.dir = 1;   // direction: 1 or -1
    this.speed = GAME.baseSpeed;

    this.zoneCenter = 0;
    this.zoneSize = GAME.zoneStartSize;

    this.state = "ready"; // ready | playing | dead
    this.mode = "classic";
    this.continueUsed = false;
    this.adWatchedThisDeath = false;
    this.deathsThisSession = 0;
    this.ignoreTapUntil = 0;
    this.revivePulse = 0;
    this.adPlaying = false;
    this.perfectSlowMoTimeoutId = null;
    this.lastInterstitialDeathCount = 0;
    this.isShowingInterstitial = false;
    this.dailyKey = "";
    this.dailyBest = 0;
    this.dailyRng = null;
    this.dailyAttemptsUsed = 0;
    this.dailyBonusUsed = false;
    this.dailyLockTimeoutId = null;
    this.soundEnabled = true;
    this.hapticsEnabled = true;
    this.audioUnlocked = false;
    this.audioContext = null;
    this.audioMaster = null;
    this.lastVibrateAt = 0;
    this.settingsOpen = false;
    this.uiPointerDown = false;
    this.enableExtraGlow = false;
    this.settingsGlow = null;
    this.settingsTitleGlow = null;
    this.settingsPanelGlow = null;
    this.ringPulse = 0;
    this.bgShift = 0;
    this.ringGlowTextureKey = "ring_glow_tex";
    this.flashGlowTextureKey = "flash_glow_tex";
    this.ringAura = null;
    this.ringHalo = null;
    this.flashSprite = null;
    this.ringAuraBaseScale = 1;
    this.ringHaloBaseScale = 1;
    this.flashBaseScale = 1;
    this.gRingGlow = null;
    this.gRingCore = null;
    this.gZone = null;
    this.bgImgFar = null;
    this.bgImgBloom = null;
    this.screenFlash = null;
    this.perfectPulse = 0;
    this.impactFlashAlpha = 0;
    this.impactFlashX = 0;
    this.impactFlashY = 0;
    this.impactFlashRadius = 0;
    this.perfectFlashDuration = 200;
    this.perfectFlashTime = this.perfectFlashDuration;
    this.perfectFlashAlpha = 0;
    this.perfectFlashRadius = 0;
    this.perfectFlashScreenAlpha = 0;
    this.baseRingColor = SKINS[0].colors.ring;
    this.hotRingColor = RING_HOT.default;
    this.activeGlowStart = SKINS[0].colors.glow;
    this.activeGlowEnd = GLOW_END.default;
    this.activeZoneOuter = SKINS[0].colors.zone;
    this.activeZoneCore = 0xffffff;
    this.activeParticleTint = SKINS[0].colors.zone;
    this.activeSkinIsPrestige = false;
    this.unlockedSkins = [];
    this.activeSkinId = "default";
  }

  preload() {
    this.load.image("bg_space", assetUrl("assets/bg_space.png"));
  }

  create() {
    const { width, height } = this.scale;

    this.readSafeAreaInsets();
    this.updateLayoutMetrics();

    // Removed any full-screen Graphics fillRect background; using bg_space.png layers instead.
    if (this.textures.exists("bg_space")) {
      this.bgImgFar = this.add.image(this.cx, this.cy, "bg_space").setDepth(-60).setAlpha(0.35);
      this.bgImgFar.setScrollFactor(0);
      this.fitImageToScreen(this.bgImgFar);
      this.bgImgFar.setScale(this.bgImgFar.scale * 1.08);
      this.bgImgFar.setTint(0x5069a8);

      this.bgImg = this.add.image(this.cx, this.cy, "bg_space").setDepth(-50);
      this.bgImg.setScrollFactor(0);
      this.fitImageToScreen(this.bgImg);
      this.bgImg.setScale(this.bgImg.scale * 1.02);

      this.bgImgBloom = this.add.image(this.cx, this.cy, "bg_space").setDepth(-40).setAlpha(0.18);
      this.bgImgBloom.setScrollFactor(0);
      this.fitImageToScreen(this.bgImgBloom);
      this.bgImgBloom.setScale(this.bgImgBloom.scale * 1.05);
      this.bgImgBloom.setBlendMode(Phaser.BlendModes.ADD);
      this.bgImgBloom.setTint(0x7dd3fc);
    } else {
      this.bgImg = null;
      this.bgImgFar = null;
      this.bgImgBloom = null;
    }
    this.gBg = null;
    this.stars = [];

    this.createGlowTextures();
    this.ringAura = this.add.image(this.cx, this.cy, this.ringGlowTextureKey)
      .setDepth(1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.18);
    this.ringHalo = this.add.image(this.cx, this.cy, this.ringGlowTextureKey)
      .setDepth(3)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.12);
    this.ringAuraBaseScale = (this.r * 3.4) / this.ringAura.width;
    this.ringHaloBaseScale = (this.r * 2.3) / this.ringHalo.width;
    this.ringAura.setScale(this.ringAuraBaseScale);
    this.ringHalo.setScale(this.ringHaloBaseScale);

    this.gRingGlow = this.add.graphics().setDepth(4).setBlendMode(Phaser.BlendModes.ADD);
    this.gRingCore = this.add.graphics().setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
    this.gZone = this.add.graphics().setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
    this.gMarker = this.add.graphics().setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
    this.gImpact = this.add.graphics().setDepth(8).setBlendMode(Phaser.BlendModes.ADD);
    this.flashSprite = this.add.image(this.cx, this.cy, this.flashGlowTextureKey)
      .setDepth(9)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);
    this.flashBaseScale = (this.r * 2.8) / this.flashSprite.width;
    this.flashSprite.setScale(this.flashBaseScale);
    this.screenFlash = this.add.rectangle(this.cx, this.cy, width, height, 0xffffff, 0)
      .setDepth(10)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScrollFactor(0);

    this.loadSettings();
    this.loadSkinState();

    // Particle textures + emitters (generated, no assets)
    if (!this.textures.exists("p_dot") || !this.textures.exists("p_ring") || !this.textures.exists("p_spark")) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      if (!this.textures.exists("p_dot")) {
        g.fillStyle(0xffffff, 1);
        g.fillCircle(8, 8, 4);
        g.generateTexture("p_dot", 16, 16);
        g.clear();
      }
      if (!this.textures.exists("p_ring")) {
        g.lineStyle(2, 0xffffff, 0.9);
        g.strokeCircle(8, 8, 5);
        g.generateTexture("p_ring", 16, 16);
        g.clear();
      }
      if (!this.textures.exists("p_spark")) {
        g.fillStyle(0xffffff, 1);
        g.fillRect(7, 0, 2, 16);
        g.generateTexture("p_spark", 16, 16);
      }
      g.destroy();
    }

    this.hitEmitter = this.add.particles(0, 0, "p_dot", {
      emitting: false,
      lifespan: { min: 180, max: 320 },
      speed: { min: 40, max: 120 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.9, end: 0 },
      blendMode: "ADD"
    }).setDepth(6);

    this.perfectEmitter = this.add.particles(0, 0, "p_dot", {
      emitting: false,
      lifespan: { min: 700, max: 1200 },
      speed: { min: 60, max: 140 },
      scale: { start: 1.05, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD"
    }).setDepth(6);

    this.missEmitter = this.add.particles(0, 0, "p_dot", {
      emitting: false,
      lifespan: { min: 260, max: 520 },
      speed: { min: 140, max: 260 },
      scale: { start: 1.0, end: 0 },
      alpha: { start: 0.95, end: 0 },
      blendMode: "ADD"
    }).setDepth(6);

    this.missRingEmitter = this.add.particles(0, 0, "p_ring", {
      emitting: false,
      lifespan: { min: 300, max: 560 },
      speed: { min: 90, max: 190 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 0.7, end: 0 },
      blendMode: "ADD"
    }).setDepth(6);

    this.perfectRayEmitter = this.add.particles(0, 0, "p_spark", {
      emitting: false,
      lifespan: { min: 160, max: 260 },
      speed: { min: 180, max: 320 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.9, end: 0 },
      angle: { min: 0, max: 360 },
      blendMode: "ADD"
    }).setDepth(6);

    this.ambientEmitter = this.add.particles(0, 0, "p_dot", {
      x: { min: 0, max: width },
      y: { min: 0, max: height },
      lifespan: 8000,
      speedY: { min: -6, max: -2 },
      scale: { start: 0.6, end: 0 },
      alpha: { start: 0.08, end: 0 },
      quantity: 1,
      frequency: 500
    }).setDepth(-9);

    this.centerScoreGlow = this.add.text(this.cx, this.cy, "0", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(this.r * 0.72) + "px",
      color: "#7dd3fc",
      fontStyle: "700",
      letterSpacing: 1
    }).setOrigin(0.5).setAlpha(0.34).setScale(1.12).setBlendMode(Phaser.BlendModes.ADD);

    this.centerScoreText = this.add.text(this.cx, this.cy, "0", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(this.r * 0.72) + "px",
      color: "#ffffff",
      fontStyle: "700",
      letterSpacing: 1
    }).setOrigin(0.5);

    this.centerBestGlow = this.add.text(this.cx, this.cy + this.r * 0.48, "BEST 0", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(this.r * 0.18) + "px",
      color: "#7dd3fc",
      fontStyle: "600",
      letterSpacing: 2
    }).setOrigin(0.5).setAlpha(0.26).setScale(1.16).setBlendMode(Phaser.BlendModes.ADD);

    this.centerBestText = this.add.text(this.cx, this.cy + this.r * 0.48, "BEST 0", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(this.r * 0.18) + "px",
      color: "#e9f2ff",
      fontStyle: "600",
      letterSpacing: 2
    }).setOrigin(0.5);

    this.skinNameText = this.add.text(this.cx, this.cy + this.r * 0.68, "", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(this.r * 0.16) + "px",
      color: "#cfe2ff",
      fontStyle: "600",
      letterSpacing: 1
    }).setOrigin(0.5).setAlpha(0);

    const baseMargin = Math.max(10, Math.min(width, height) * 0.03);
    const topOffset = (this.safeTop || 0) + baseMargin;
    const attemptsInitialY = topOffset + Math.max(42, this.r * 0.25);

    this.attemptsGlow = this.add.text(this.cx, attemptsInitialY, "ATTEMPTS: 0 / 3", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.026) + "px",
      color: "#7dd3fc",
      fontStyle: "600",
      letterSpacing: 1
    }).setOrigin(0.5).setAlpha(0.2).setScale(1.1).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);

    this.attemptsText = this.add.text(this.cx, attemptsInitialY, "ATTEMPTS: 0 / 3", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.026) + "px",
      color: "#9aa7c7",
      fontStyle: "600",
      letterSpacing: 1
    }).setOrigin(0.5).setVisible(false);

    this.createModePill();

    this.hintGlow = this.add.text(this.cx, this.cy + this.r * 1.55, "TAP TO START", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: "#7dd3fc",
      fontStyle: "600",
      letterSpacing: 3
    }).setOrigin(0.5).setAlpha(0.28).setScale(1.12).setBlendMode(Phaser.BlendModes.ADD);

    this.hintText = this.add.text(this.cx, this.cy + this.r * 1.55, "TAP TO START", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: "#9aa7c7",
      fontStyle: "600",
      letterSpacing: 3
    }).setOrigin(0.5);

    this.createSettingsUI();
    this.layoutHud();
    this.applySkinById(this.activeSkinId, true);

    // Game over overlay
    this.overGroup = this.add.container(0, 0).setVisible(false).setDepth(10);
    const panelW = Math.min(width * 0.84, 420);
    const panelH = Math.min(height * 0.42, 320);

    const panel = this.add.rectangle(this.cx, this.cy, panelW, panelH, 0x111a2e, 0.92)
      .setStrokeStyle(2, 0x2a3a6a, 1);

    const overlayGlowHex = "#" + this.activeParticleTint.toString(16).padStart(6, "0");
    this.overTitleGlow = this.add.text(this.cx, this.cy - panelH * 0.24, "GAME OVER", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.04) + "px",
      color: overlayGlowHex
    }).setOrigin(0.5).setAlpha(0.28).setScale(1.12).setBlendMode(Phaser.BlendModes.ADD);
    this.overTitle = this.add.text(this.cx, this.cy - panelH * 0.24, "GAME OVER", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.04) + "px",
      color: "#ffffff"
    }).setOrigin(0.5);

    this.overScoreGlow = this.add.text(this.cx, this.cy - panelH * 0.02, "Score: 0", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: overlayGlowHex
    }).setOrigin(0.5).setAlpha(0.24).setScale(1.1).setBlendMode(Phaser.BlendModes.ADD);
    this.overScore = this.add.text(this.cx, this.cy - panelH * 0.02, "Score: 0", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: "#cfe2ff"
    }).setOrigin(0.5);

    this.overBestGlow = this.add.text(this.cx, this.cy + panelH * 0.10, "Best: 0", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: overlayGlowHex
    }).setOrigin(0.5).setAlpha(0.22).setScale(1.1).setBlendMode(Phaser.BlendModes.ADD);
    this.overBest = this.add.text(this.cx, this.cy + panelH * 0.10, "Best: 0", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: "#cfe2ff"
    }).setOrigin(0.5);

    this.overCTAGlow = this.add.text(this.cx, this.cy + panelH * 0.18, "CHOOSE", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.026) + "px",
      color: overlayGlowHex
    }).setOrigin(0.5).setAlpha(0.22).setScale(1.08).setBlendMode(Phaser.BlendModes.ADD);
    this.overCTA = this.add.text(this.cx, this.cy + panelH * 0.18, "CHOOSE", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.026) + "px",
      color: "#9aa7c7"
    }).setOrigin(0.5);

    const buttonW = panelW * 0.68;
    const buttonH = Math.max(48, Math.min(height * 0.07, 62));
    const buttonGap = Math.max(10, buttonH * 0.2);
    const buttonStartY = this.cy + panelH * 0.24;

    this.retryButton = this.createPanelButton("RETRY", buttonW, buttonH);
    this.retryButton.container.setPosition(this.cx, buttonStartY);
    this.retryButton.onClick(() => this.onRetry());

    this.continueButton = this.createPanelButton("CONTINUE", buttonW, buttonH);
    this.continueButton.container.setPosition(this.cx, buttonStartY + buttonH + buttonGap);
    this.continueButton.onClick(() => this.onContinue());

    this.extraAttemptButton = this.createPanelButton("EXTRA ATTEMPT (AD)", buttonW * 0.9, buttonH * 0.85);
    this.extraAttemptButton.container.setPosition(this.cx, buttonStartY + buttonH + buttonGap);
    this.extraAttemptButton.container.setVisible(false);
    this.extraAttemptButton.setEnabled(false);
    this.extraAttemptButton.onClick(() => this.onExtraAttempt());

    this.shareButton = this.createPanelButton("SHARE", buttonW * 0.86, buttonH * 0.9);
    this.shareButton.container.setPosition(this.cx, buttonStartY + (buttonH + buttonGap) * 2);
    this.shareButton.container.setVisible(false);
    this.shareButton.setEnabled(false);
    this.shareButton.onClick(() => this.onShare());

    this.overGroup.add([
      panel,
      this.overTitleGlow,
      this.overTitle,
      this.overScoreGlow,
      this.overScore,
      this.overBestGlow,
      this.overBest,
      this.overCTAGlow,
      this.overCTA,
      this.retryButton.container,
      this.continueButton.container,
      this.extraAttemptButton.container,
      this.shareButton.container
    ]);

    // Rewarded ad overlay
    this.adOverlay = this.add.container(0, 0).setVisible(false).setDepth(20);
    const adBg = this.add.rectangle(this.cx, this.cy, width, height, 0x0b0f1a, 0.88);
    this.adText = this.add.text(this.cx, this.cy, "WATCHING AD...", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.04) + "px",
      color: "#ffffff"
    }).setOrigin(0.5);
    this.adOverlay.add([adBg, this.adText]);

    // Daily attempts lock overlay
    this.dailyLockOverlay = this.add.container(0, 0).setVisible(false).setDepth(25);
    const lockBg = this.add.rectangle(this.cx, this.cy, width, height, 0x0b0f1a, 0.8);
    this.dailyLockTitle = this.add.text(this.cx, this.cy - this.r * 0.1, "NO ATTEMPTS LEFT", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.04) + "px",
      color: "#ffffff"
    }).setOrigin(0.5);
    this.dailyLockSub = this.add.text(this.cx, this.cy + this.r * 0.06, "Next Daily in 00:00", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: "#9aa7c7"
    }).setOrigin(0.5);
    this.dailyLockOverlay.add([lockBg, this.dailyLockTitle, this.dailyLockSub]);

    // Input
    this.input.on("gameobjectdown", (pointer, gameObject) => {
      if (gameObject && gameObject.isUiElement) this.uiPointerDown = true;
    });
    this.input.on("pointerdown", (pointer, currentlyOver) => this.onTap(pointer, currentlyOver));

    // Load best score from localStorage
    const saved = Number(localStorage.getItem("taplock_best") || 0);
    this.best = Number.isFinite(saved) ? saved : 0;
    this.ensureDailyData();
    this.updateBestText();
    this.updateModeUI(true);
    this.updateAttemptsText();
    this.updateSettingsUI();

    this.resetRound(true);
    this.updateSettingsButtonState();

    this.applyGlowPreference();

    // Resume audio when returning from background.
    this.visibilityHandler = () => {
      if (!document.hidden) this.resumeAudioIfNeeded();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.events.once("shutdown", () => {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    });

    // Handle resize
    this.scale.on("resize", () => this.scene.restart());
  }

  resetRound(showHint) {
    this.score = 0;
    this.speed = GAME.baseSpeed;
    if (this.mode === "daily") {
      this.ensureDailyData();
      this.dailyRng = this.makeSeededRng(this.hashStringToSeed(this.dailyKey));
      this.angle = this.dailyRng() * Math.PI * 2;
      this.dir = this.dailyRng() < 0.5 ? 1 : -1;
      this.zoneSize = GAME.zoneStartSize;
      this.zoneCenter = this.pickNewZoneCenter(0.9, this.dailyRng);
    } else {
      this.dailyRng = null;
      this.angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      this.dir = Phaser.Math.Between(0, 1) === 0 ? 1 : -1;
      this.zoneSize = GAME.zoneStartSize;
      this.zoneCenter = Phaser.Math.FloatBetween(0, Math.PI * 2);
    }

    this.state = showHint ? "ready" : "playing";
    this.continueUsed = false;
    this.adWatchedThisDeath = false;
    this.ignoreTapUntil = 0;
    this.revivePulse = 0;
    this.perfectFlashTime = this.perfectFlashDuration;
    this.perfectFlashAlpha = 0;
    this.perfectFlashScreenAlpha = 0;
    this.adPlaying = false;
    this.isShowingInterstitial = false;
    this.time.timeScale = 1;
    if (this.perfectSlowMoTimeoutId) {
      clearTimeout(this.perfectSlowMoTimeoutId);
      this.perfectSlowMoTimeoutId = null;
    }

    if (this.centerScoreText) {
      this.centerScoreText.setText("0");
      this.centerScoreText.setScale(1);
    }
    if (this.centerScoreGlow) {
      this.centerScoreGlow.setText("0");
      this.centerScoreGlow.setScale(1.12);
      this.centerScoreGlow.setAlpha(0.34);
    }
    this.updateBestText();
    this.updateAttemptsText();
    this.hintText.setVisible(showHint);
    this.hintText.setAlpha(1);
    if (this.hintGlow) {
      this.hintGlow.setVisible(showHint);
      this.hintGlow.setAlpha(0.3);
    }
    this.overGroup.setVisible(false);
    if (this.adOverlay) this.adOverlay.setVisible(false);
    if (this.dailyLockOverlay) this.dailyLockOverlay.setVisible(false);
    if (this.retryButton) this.retryButton.setEnabled(true);
    if (this.continueButton) this.updateContinueButton();
    this.hideSettingsPanel();
    this.updateSettingsButtonState();

    this.cameras.main.flash(80, 255, 255, 255);
  }

  // Daily mode helpers (date key + seeded RNG)
  readSafeAreaInsets() {
    const styles = getComputedStyle(document.documentElement);
    const parsePx = (value) => {
      const n = parseFloat((value || "").toString().replace("px", "").trim());
      return Number.isFinite(n) ? n : 0;
    };
    this.safeTop = parsePx(styles.getPropertyValue("--safe-top"));
    this.safeRight = parsePx(styles.getPropertyValue("--safe-right"));
    this.safeBottom = parsePx(styles.getPropertyValue("--safe-bottom"));
    this.safeLeft = parsePx(styles.getPropertyValue("--safe-left"));
  }

  createModePill() {
    const { width, height } = this.scale;
    const compact = height < 700;
    const baseMargin = Math.max(10, Math.min(width, height) * 0.03);
    const topOffset = (this.safeTop || 0) + baseMargin;
    const w = Math.min(320, width * 0.72);
    const h = 44;
    const x = this.cx;
    const y = topOffset + (compact ? 18 : 22);

    const pillBg = this.add.rectangle(0, 0, w, h, 0x0b0f1a, 0.25).setOrigin(0.5);
    const pillStroke = this.add.graphics();
    pillStroke.lineStyle(2, 0x7dd3fc, 0.55);
    pillStroke.strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);

    const tabW = (w / 2) - 6;
    const tabH = h - 8;
    this.modePillWidth = w;
    this.modePillHeight = h;
    this.modeTabWidth = tabW;
    this.modeTabHeight = tabH;
    this.modeTab = this.add.rectangle(-w / 4, 0, tabW, tabH, 0x2a6bff, 0.25).setOrigin(0.5);

    this.modeTabGlow = this.add.graphics();
    this.modeTabGlow.fillStyle(0x2a6bff, 0.18);
    this.modeTabGlow.fillRoundedRect(-tabW / 2, -tabH / 2, tabW, tabH, tabH / 2);
    this.modeTabGlow.x = -w / 4;

    const modeGlowHex = "#" + this.activeParticleTint.toString(16).padStart(6, "0");
    this.modeClassicGlow = this.add.text(-w / 4, 0, "CLASSIC", {
      fontFamily: UI_FONT,
      fontSize: "15px",
      color: modeGlowHex
    }).setOrigin(0.5).setAlpha(0.22).setScale(1.12).setBlendMode(Phaser.BlendModes.ADD);
    this.modeClassicText = this.add.text(-w / 4, 0, "CLASSIC", {
      fontFamily: UI_FONT,
      fontSize: "15px",
      color: "#ffffff"
    }).setOrigin(0.5);

    this.modeDailyGlow = this.add.text(w / 4, 0, "DAILY", {
      fontFamily: UI_FONT,
      fontSize: "15px",
      color: modeGlowHex
    }).setOrigin(0.5).setAlpha(0.18).setScale(1.1).setBlendMode(Phaser.BlendModes.ADD);
    this.modeDailyText = this.add.text(w / 4, 0, "DAILY", {
      fontFamily: UI_FONT,
      fontSize: "15px",
      color: "#7f8db8"
    }).setOrigin(0.5);

    this.modePill = this.add.container(x, y, [
      pillBg,
      this.modeTabGlow,
      this.modeTab,
      pillStroke,
      this.modeClassicGlow,
      this.modeClassicText,
      this.modeDailyGlow,
      this.modeDailyText
    ]).setDepth(12);

    const hit = new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h);
    this.modePill.setSize(w, h);

    this.modeClassicHit = this.add.rectangle(-w / 4, 0, tabW, tabH, 0x000000, 0.001)
      .setOrigin(0.5)
      .setInteractive();
    this.modeClassicHit.isUiElement = true;
    this.modeClassicHit.on("pointerdown", () => {
      if (this.adPlaying || this.isShowingInterstitial) return;
      this.setMode("classic");
    });

    this.modeDailyHit = this.add.rectangle(w / 4, 0, tabW, tabH, 0x000000, 0.001)
      .setOrigin(0.5)
      .setInteractive();
    this.modeDailyHit.isUiElement = true;
    this.modeDailyHit.on("pointerdown", () => {
      if (this.adPlaying || this.isShowingInterstitial) return;
      this.setMode("daily");
    });

    this.modePill.add([this.modeClassicHit, this.modeDailyHit]);

    this.updateModePillUI(true);
  }

  updateModePillUI(instant = false) {
    if (!this.modePill || !this.modeTab) return;
    const isClassic = this.mode === "classic";
    const w = this.modePillWidth || this.modePill.list[0].width;
    const targetX = isClassic ? -w / 4 : w / 4;

    this.tweens.add({
      targets: [this.modeTab, this.modeTabGlow],
      x: targetX,
      duration: instant ? 0 : 180,
      ease: "Cubic.Out"
    });

    if (this.modeClassicText && this.modeDailyText) {
      this.modeClassicText.setColor(isClassic ? "#ffffff" : "#7f8db8");
      this.modeDailyText.setColor(isClassic ? "#7f8db8" : "#ffffff");
      this.modeClassicText.setScale(isClassic ? 1.06 : 1.0);
      this.modeDailyText.setScale(isClassic ? 1.0 : 1.06);
    }
    if (this.enableExtraGlow && this.modeClassicGlow && this.modeDailyGlow) {
      this.modeClassicGlow.setAlpha(isClassic ? 0.28 : 0.16);
      this.modeDailyGlow.setAlpha(isClassic ? 0.16 : 0.28);
      this.modeClassicGlow.setScale(isClassic ? 1.14 : 1.1);
      this.modeDailyGlow.setScale(isClassic ? 1.1 : 1.14);
    }

    if (this.modeTabGlow && this.modeTabWidth && this.modeTabHeight) {
      this.modeTabGlow.clear();
      this.modeTabGlow.fillStyle(0x2a6bff, 0.18);
      this.modeTabGlow.fillRoundedRect(-this.modeTabWidth / 2, -this.modeTabHeight / 2, this.modeTabWidth, this.modeTabHeight, this.modeTabHeight / 2);
    }
  }

  layoutHud() {
    const { width, height } = this.scale;
    const baseMargin = this.layoutBaseMargin ?? Math.max(10, Math.min(width, height) * 0.03);
    const topOffset = this.layoutTopOffset ?? ((this.safeTop || 0) + baseMargin);
    const rightOffset = (this.safeRight || 0) + baseMargin;
    const compact = this.layoutCompact ?? (height < 700);

    if (this.centerScoreText && this.centerBestText) {
      this.centerScoreText.setX(this.cx);
      this.centerScoreText.setY(this.cy);
      this.centerBestText.setX(this.cx);
      this.centerBestText.setY(this.cy + this.r * 0.48);
      if (this.centerScoreGlow) {
        this.centerScoreGlow.setX(this.cx);
        this.centerScoreGlow.setY(this.cy);
      }
      if (this.centerBestGlow) {
        this.centerBestGlow.setX(this.cx);
        this.centerBestGlow.setY(this.cy + this.r * 0.48);
      }

      const scoreSize = Math.max(44, Math.floor(this.r * 0.72));
      const bestSize = Math.max(12, Math.floor(this.r * 0.18));
      this.centerScoreText.setFontSize(scoreSize + "px");
      this.centerBestText.setFontSize(bestSize + "px");
      if (this.centerScoreGlow) this.centerScoreGlow.setFontSize(scoreSize + "px");
      if (this.centerBestGlow) this.centerBestGlow.setFontSize(bestSize + "px");
    }

    if (this.modePill) {
      this.modePill.setX(this.cx);
      this.modePill.setY(this.layoutModePillY ?? (topOffset + (compact ? 18 : 22)));
    }

    if (this.attemptsText) {
      const attemptsSize = Math.max(13, Math.floor(Math.min(width, height) * 0.026));
      this.attemptsText.setFontSize(attemptsSize + "px");
      const attemptsY = this.modePill ? this.modePill.y + (compact ? 28 : 34) : topOffset + 64;
      this.attemptsText.setX(this.cx);
      this.attemptsText.setY(attemptsY);
    }
    if (this.attemptsGlow) {
      const attemptsSize = Math.max(13, Math.floor(Math.min(width, height) * 0.026));
      this.attemptsGlow.setFontSize(attemptsSize + "px");
      const attemptsY = this.modePill ? this.modePill.y + (compact ? 28 : 34) : topOffset + 64;
      this.attemptsGlow.setX(this.cx);
      this.attemptsGlow.setY(attemptsY);
    }

    if (this.skinNameText) {
      const nameSize = Math.max(12, Math.floor(this.r * 0.16));
      this.skinNameText.setFontSize(nameSize + "px");
      this.skinNameText.setX(this.cx);
      this.skinNameText.setY(this.cy + this.r * 0.68);
    }

    if (this.hintText) {
      const hintSize = this.layoutHintSize ?? Math.floor(Math.min(width, height) * 0.03);
      this.hintText.setFontSize(hintSize + "px");
      this.hintText.setX(this.cx);
      this.hintText.setY(this.layoutHintY ?? (this.cy + this.r * (compact ? 1.35 : 1.55)));
      if (this.hintGlow) {
        this.hintGlow.setFontSize(hintSize + "px");
        this.hintGlow.setX(this.cx);
        this.hintGlow.setY(this.layoutHintY ?? (this.cy + this.r * (compact ? 1.35 : 1.55)));
      }
    }

    if (this.settingsButton) {
      this.settingsButton.setX(width - rightOffset);
      this.settingsButton.setY(topOffset + this.settingsButton.height * 0.5);
    }
    if (this.settingsGlow) {
      this.settingsGlow.setX(width - rightOffset);
      this.settingsGlow.setY(topOffset + this.settingsGlow.height * 0.5);
    }
  }

  fitImageToScreen(img) {
    const sw = this.scale.width;
    const sh = this.scale.height;
    const iw = img.width;
    const ih = img.height;
    const scale = Math.max(sw / iw, sh / ih);
    img.setScale(scale);
    img.setPosition(sw / 2, sh / 2);
  }

  updateLayoutMetrics() {
    const { width, height } = this.scale;
    const baseMargin = Math.max(10, Math.min(width, height) * 0.03);
    const topOffset = (this.safeTop || 0) + baseMargin;
    const bottomOffset = (this.safeBottom || 0) + baseMargin;
    const compact = height < 700;
    const modePillHeight = 44;
    const modePillY = topOffset + (compact ? 18 : 22);
    const modePillBottom = modePillY + modePillHeight / 2;
    const ringTopGap = compact ? 12 : 18;
    const hintRatio = compact ? 1.32 : 1.55;
    const hintSize = Math.max(12, Math.floor(Math.min(width, height) * 0.03));
    const hintBottomPad = bottomOffset + hintSize * 0.6;

    this.cx = width / 2;
    this.cy = height / 2;

    const maxRFromTop = this.cy - (modePillBottom + ringTopGap);
    const maxRFromHint = (height - hintBottomPad - this.cy) / hintRatio;
    const targetR = Math.min(width, height) * 0.28;
    let r = Math.min(targetR, maxRFromTop, maxRFromHint);
    if (!Number.isFinite(r)) r = targetR;
    r = Math.max(32, r);

    this.r = r;
    this.rMarker = this.r * 0.06;
    this.layoutCompact = compact;
    this.layoutBaseMargin = baseMargin;
    this.layoutTopOffset = topOffset;
    this.layoutBottomOffset = bottomOffset;
    this.layoutModePillY = modePillY;
    this.layoutHintY = this.cy + this.r * hintRatio;
    this.layoutHintSize = hintSize;
  }

  createGlowTextures() {
    this.createRadialTexture(this.ringGlowTextureKey, 256, [
      { stop: 0, alpha: 0.9 },
      { stop: 0.45, alpha: 0.25 },
      { stop: 1, alpha: 0 }
    ]);
    this.createRadialTexture(this.flashGlowTextureKey, 512, [
      { stop: 0, alpha: 1 },
      { stop: 0.35, alpha: 0.5 },
      { stop: 1, alpha: 0 }
    ]);
  }

  createRadialTexture(key, size, stops) {
    if (this.textures.exists(key)) return;
    const tex = this.textures.createCanvas(key, size, size);
    const ctx = tex.getContext();
    const cx = size * 0.5;
    const cy = size * 0.5;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.5);
    stops.forEach((stop) => {
      grad.addColorStop(stop.stop, `rgba(255, 255, 255, ${stop.alpha})`);
    });
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }

  drawRingLayers() {
    if (!this.gRingGlow || !this.gRingCore || !this.gZone) return;

    const glow = this.gRingGlow;
    const core = this.gRingCore;
    const zone = this.gZone;
    glow.clear();
    core.clear();
    zone.clear();

    const t = Math.min(1, this.score / 25);
    const ringColor = this.lerpColorInt(this.baseRingColor, this.hotRingColor, t);
    const glowColor = this.lerpColorInt(this.activeGlowStart, this.activeGlowEnd, t);
    const coreColor = this.lerpColorInt(ringColor, glowColor, 0.45);
    const shimmer = this.activeSkinIsPrestige ? (0.04 + 0.05 * Math.sin(this.time.now * 0.002)) : 0;

    const coreThickness = Math.max(6, this.r * 0.085);
    const glowThickness = Math.max(12, coreThickness * 1.7);
    const outerThickness = Math.max(16, coreThickness * 2.9);
    const innerThickness = Math.max(3, coreThickness * 0.45);

    const outerAlpha = Phaser.Math.Clamp(0.1 + this.ringPulse * 0.04 + shimmer, 0.08, 0.15);
    const glowAlpha = Phaser.Math.Clamp(0.3 + this.ringPulse * 0.1 + shimmer, 0.25, 0.4);
    const coreAlpha = Phaser.Math.Clamp(0.9 + shimmer, 0.85, 1.0);
    const innerAlpha = Phaser.Math.Clamp(0.06 + this.ringPulse * 0.03 + shimmer * 0.5, 0.05, 0.1);

    // Layer A - Outer bloom
    glow.lineStyle(outerThickness, glowColor, outerAlpha);
    glow.strokeCircle(this.cx, this.cy, this.r);
    // Layer B - Glow ring
    glow.lineStyle(glowThickness, glowColor, glowAlpha);
    glow.strokeCircle(this.cx, this.cy, this.r);
    // Layer C - Core ring
    core.lineStyle(coreThickness, coreColor, coreAlpha);
    core.strokeCircle(this.cx, this.cy, this.r);
    // Layer D - Inner glow
    glow.lineStyle(innerThickness, glowColor, innerAlpha);
    glow.strokeCircle(this.cx, this.cy, this.r);

    // Zone arc (glowing + hot)
    const half = this.zoneSize / 2;
    const start = this.normAngle(this.zoneCenter - half);
    const end = this.normAngle(this.zoneCenter + half);
    const distToCenter = this.circularDistance(this.angle, this.zoneCenter);
    const approach = Phaser.Math.Clamp(1 - distToCenter / (this.zoneSize * 1.2), 0, 1);

    const zoneOuterThickness = coreThickness * 2.8;
    const zoneCoreThickness = coreThickness * 1.8;
    const zoneInnerThickness = Math.max(3, coreThickness * 0.65);
    const zoneOuterAlpha = Phaser.Math.Clamp(0.45 + approach * 0.45, 0.45, 0.9);
    const zoneCoreAlpha = Phaser.Math.Clamp(0.9 + approach * 0.1, 0.9, 1);
    const zoneInnerAlpha = Phaser.Math.Clamp(0.08 + approach * 0.14, 0.08, 0.22);
    const zoneHotColor = this.lerpColorInt(this.activeZoneOuter, 0xffffff, 0.3 + approach * 0.45);

    const drawZoneArc = (thickness, color, alpha) => {
      zone.lineStyle(thickness, color, alpha);
      zone.beginPath();
      if (start <= end) {
        zone.arc(this.cx, this.cy, this.r, start, end, false);
        zone.strokePath();
      } else {
        zone.arc(this.cx, this.cy, this.r, start, Math.PI * 2, false);
        zone.strokePath();
        zone.beginPath();
        zone.arc(this.cx, this.cy, this.r, 0, end, false);
        zone.strokePath();
      }
    };

    // Outer hot bloom (thicker than core ring)
    drawZoneArc(zoneOuterThickness, zoneHotColor, zoneOuterAlpha);
    // Core danger band (brightest)
    drawZoneArc(zoneCoreThickness, this.activeZoneCore, zoneCoreAlpha);
    // Inner flicker glow
    drawZoneArc(zoneInnerThickness, zoneHotColor, zoneInnerAlpha);
  }

  loadSkinState() {
    const saved = localStorage.getItem("taplock_unlocked_skins");
    let unlocked = [];
    try {
      unlocked = saved ? JSON.parse(saved) : [];
    } catch (e) {
      unlocked = [];
    }
    if (!Array.isArray(unlocked)) unlocked = [];
    if (!unlocked.includes("default")) unlocked.unshift("default");
    this.unlockedSkins = unlocked;
    localStorage.setItem("taplock_unlocked_skins", JSON.stringify(this.unlockedSkins));

    const active = localStorage.getItem("taplock_active_skin");
    if (active && this.unlockedSkins.includes(active)) this.activeSkinId = active;
    else {
      this.activeSkinId = "default";
      localStorage.setItem("taplock_active_skin", this.activeSkinId);
    }
  }

  getSkinById(id) {
    return SKINS.find((s) => s.id === id) || SKINS[0];
  }

  safeSetTextColor(textObj, color) {
    if (!textObj || !textObj.scene || !textObj.texture || !textObj.frame) return;
    if (typeof textObj.setColor !== "function") return;
    textObj.setColor(color);
  }

  safeSetFillStyle(shapeObj, color, alpha = 1) {
    if (!shapeObj || !shapeObj.scene || typeof shapeObj.setFillStyle !== "function") return;
    shapeObj.setFillStyle(color, alpha);
  }

  setEmitterTint(emitterOrManager, tint) {
    if (!emitterOrManager) return;
    if (typeof emitterOrManager.setTint === "function") {
      emitterOrManager.setTint(tint);
      return;
    }
    if (emitterOrManager.emitters && emitterOrManager.emitters.list) {
      emitterOrManager.emitters.list.forEach((emitter) => {
        if (emitter && typeof emitter.setTint === "function") {
          emitter.setTint(tint);
        }
      });
    }
  }

  applySkinById(id, silent = false) {
    if (!this.unlockedSkins.includes(id)) return;
    this.activeSkinId = id;
    localStorage.setItem("taplock_active_skin", id);
    const skin = this.getSkinById(id);
    this.baseRingColor = skin.colors.ring;
    this.hotRingColor = RING_HOT[skin.id] || skin.colors.ring;
    this.activeGlowStart = skin.colors.glow;
    this.activeGlowEnd = GLOW_END[skin.id] || skin.colors.glow;
    this.activeZoneOuter = skin.colors.zone;
    this.activeZoneCore = 0xffffff;
    this.activeParticleTint = skin.colors.zone;
    this.activeSkinIsPrestige = !!skin.prestige;
    const glowHex = "#" + this.activeParticleTint.toString(16).padStart(6, "0");
    this.setEmitterTint(this.hitEmitter, this.activeParticleTint);
    this.setEmitterTint(this.perfectEmitter, this.activeParticleTint);
    this.setEmitterTint(this.missEmitter, this.activeParticleTint);
    this.setEmitterTint(this.missRingEmitter, this.activeParticleTint);
    this.setEmitterTint(this.perfectRayEmitter, this.activeParticleTint);
    if (this.enableExtraGlow) {
      this.safeSetTextColor(this.centerScoreGlow, glowHex);
      this.safeSetTextColor(this.centerBestGlow, glowHex);
      this.safeSetTextColor(this.hintGlow, glowHex);
      this.safeSetTextColor(this.attemptsGlow, glowHex);
      this.safeSetTextColor(this.settingsGlow, glowHex);
      this.safeSetTextColor(this.settingsTitleGlow, glowHex);
      this.safeSetFillStyle(this.settingsPanelGlow, this.activeParticleTint, 0.12);
      if (this.soundToggle) {
        this.safeSetTextColor(this.soundToggle.labelGlow, glowHex);
        this.safeSetTextColor(this.soundToggle.valueGlow, this.soundEnabled ? "#86efac" : "#9aa7c7");
      }
      if (this.hapticsToggle) {
        this.safeSetTextColor(this.hapticsToggle.labelGlow, glowHex);
        this.safeSetTextColor(this.hapticsToggle.valueGlow, this.hapticsEnabled ? "#86efac" : "#9aa7c7");
      }
      this.safeSetTextColor(this.overTitleGlow, glowHex);
      this.safeSetTextColor(this.overScoreGlow, glowHex);
      this.safeSetTextColor(this.overBestGlow, glowHex);
      this.safeSetTextColor(this.overCTAGlow, glowHex);
      this.safeSetTextColor(this.modeClassicGlow, glowHex);
      this.safeSetTextColor(this.modeDailyGlow, glowHex);
      if (this.retryButton && this.retryButton.glow) this.safeSetTextColor(this.retryButton.glow, glowHex);
      if (this.continueButton && this.continueButton.glow) this.safeSetTextColor(this.continueButton.glow, glowHex);
      if (this.extraAttemptButton && this.extraAttemptButton.glow) this.safeSetTextColor(this.extraAttemptButton.glow, glowHex);
      if (this.shareButton && this.shareButton.glow) this.safeSetTextColor(this.shareButton.glow, glowHex);
    }
    if (this.ringAura) this.ringAura.setTint(this.activeGlowStart);
    if (this.ringHalo) this.ringHalo.setTint(this.activeGlowEnd);
    if (this.flashSprite) this.flashSprite.setTint(this.activeGlowEnd);
    if (this.bgImgBloom) this.bgImgBloom.setTint(this.activeGlowStart);
    if (this.bgImgFar) this.bgImgFar.setTint(this.activeGlowEnd);
    if (this.screenFlash) this.screenFlash.setFillStyle(this.activeGlowEnd, 1);
    if (!silent) {
      this.cameras.main.flash(60, 200, 220, 255);
      this.spawnHitBurst(this.cx, this.cy);
      this.playTapSfx();
      this.vibrate(5);
      this.showSkinToast(skin.name);
    }
  }

  cycleSkin() {
    if (this.unlockedSkins.length <= 1) return;
    const idx = this.unlockedSkins.indexOf(this.activeSkinId);
    const nextId = this.unlockedSkins[(idx + 1) % this.unlockedSkins.length];
    this.applySkinById(nextId);
  }

  showSkinToast(name) {
    if (!this.skinNameText) return;
    this.skinNameText.setText(name);
    this.skinNameText.setAlpha(1);
    this.tweens.add({
      targets: this.skinNameText,
      alpha: 0,
      duration: 900,
      ease: "Cubic.Out"
    });
  }

  checkSkinUnlocks() {
    const score = this.best;
    for (const skin of SKINS) {
      if (skin.unlockScore > 0 && score >= skin.unlockScore) {
        this.unlockSkin(skin.id);
      }
    }
  }

  unlockSkin(id) {
    if (this.unlockedSkins.includes(id)) return false;
    this.unlockedSkins.push(id);
    localStorage.setItem("taplock_unlocked_skins", JSON.stringify(this.unlockedSkins));
    const skin = this.getSkinById(id);
    this.applySkinById(id, true);
    this.cameras.main.flash(120, 255, 245, 210);
    this.spawnPerfectBurst(this.cx, this.cy);
    if (this.perfectRayEmitter) this.perfectRayEmitter.emitParticleAt(this.cx, this.cy, 16);
    this.playPerfectSfx();
    this.vibrate([8, 30, 8]);
    this.showUnlockToast(skin.name);
    return true;
  }

  showUnlockToast(name) {
    const title = this.add.text(this.cx, this.cy - this.r * 0.55, "NEW RING UNLOCKED", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(this.r * 0.18) + "px",
      color: "#ffffff"
    }).setOrigin(0.5).setDepth(25);

    const subtitle = this.add.text(this.cx, this.cy - this.r * 0.42, name, {
      fontFamily: UI_FONT,
      fontSize: Math.floor(this.r * 0.16) + "px",
      color: "#cfe2ff"
    }).setOrigin(0.5).setDepth(25);

    this.tweens.add({
      targets: [title, subtitle],
      alpha: 0,
      y: "-=12",
      duration: 900,
      ease: "Cubic.Out",
      onComplete: () => {
        title.destroy();
        subtitle.destroy();
      }
    });
  }

  lerpColorInt(c1, c2, t) {
    const r1 = (c1 >> 16) & 0xff;
    const g1 = (c1 >> 8) & 0xff;
    const b1 = c1 & 0xff;
    const r2 = (c2 >> 16) & 0xff;
    const g2 = (c2 >> 8) & 0xff;
    const b2 = c2 & 0xff;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
  }

  getTodayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  hashStringToSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  makeSeededRng(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  ensureDailyData() {
    const key = this.getTodayKey();
    let changed = false;
    if (this.dailyKey !== key) {
      this.dailyKey = key;
      changed = true;
      const saved = Number(localStorage.getItem(`taplock_daily_best_${key}`) || 0);
      this.dailyBest = Number.isFinite(saved) ? saved : 0;
      const attempts = Number(localStorage.getItem(`taplock_daily_attempts_${key}`) || 0);
      this.dailyAttemptsUsed = Number.isFinite(attempts) ? attempts : 0;
      const bonusUsed = Number(localStorage.getItem(`taplock_daily_bonus_used_${key}`) || 0);
      this.dailyBonusUsed = bonusUsed === 1;
    }
    return changed;
  }

  pulseGlow(glowText, peakAlpha = 0.4, floorAlpha = 0.18, duration = 240) {
    if (!glowText) return;
    if (!this.enableExtraGlow) {
      glowText.setAlpha(0);
      glowText.setVisible(false);
      return;
    }
    glowText.setAlpha(peakAlpha);
    this.tweens.add({
      targets: glowText,
      alpha: floorAlpha,
      duration,
      ease: "Quad.Out"
    });
  }

  applyGlowPreference() {
    const show = !!this.enableExtraGlow;
    const toggle = (obj) => {
      if (!obj) return;
      obj.setVisible(show);
      if (!show) obj.setAlpha(0);
    };

    toggle(this.ringAura);
    toggle(this.ringHalo);
    toggle(this.centerScoreGlow);
    toggle(this.centerBestGlow);
    toggle(this.hintGlow);
    toggle(this.attemptsGlow);
    toggle(this.overTitleGlow);
    toggle(this.overScoreGlow);
    toggle(this.overBestGlow);
    toggle(this.overCTAGlow);
    toggle(this.settingsGlow);
    toggle(this.settingsTitleGlow);
    toggle(this.settingsPanelGlow);
    toggle(this.modeClassicGlow);
    toggle(this.modeDailyGlow);
    if (this.retryButton && this.retryButton.glow) toggle(this.retryButton.glow);
    if (this.continueButton && this.continueButton.glow) toggle(this.continueButton.glow);
    if (this.extraAttemptButton && this.extraAttemptButton.glow) toggle(this.extraAttemptButton.glow);
    if (this.shareButton && this.shareButton.glow) toggle(this.shareButton.glow);
    if (this.soundToggle && this.soundToggle.labelGlow) toggle(this.soundToggle.labelGlow);
    if (this.soundToggle && this.soundToggle.valueGlow) toggle(this.soundToggle.valueGlow);
    if (this.hapticsToggle && this.hapticsToggle.labelGlow) toggle(this.hapticsToggle.labelGlow);
    if (this.hapticsToggle && this.hapticsToggle.valueGlow) toggle(this.hapticsToggle.valueGlow);
  }

  updateBestText() {
    if (this.mode === "daily") {
      if (this.centerBestText) this.centerBestText.setText(`DAILY BEST ${this.dailyBest}`);
      if (this.centerBestGlow) this.centerBestGlow.setText(`DAILY BEST ${this.dailyBest}`);
    } else {
      if (this.centerBestText) this.centerBestText.setText(`BEST ${this.best}`);
      if (this.centerBestGlow) this.centerBestGlow.setText(`BEST ${this.best}`);
    }
    this.pulseGlow(this.centerBestGlow, 0.34, 0.2, 260);
  }

  updateModeUI(instant = false) {
    this.updateModePillUI(instant);
  }

  updateAttemptsText() {
    if (!this.attemptsText) return;
    if (this.mode === "daily") {
      const text = `ATTEMPTS: ${this.dailyAttemptsUsed} / ${GAME.dailyMaxAttempts}`;
      this.attemptsText.setText(text);
      this.attemptsText.setVisible(true);
      if (this.attemptsGlow) {
        this.attemptsGlow.setText(text);
        this.attemptsGlow.setVisible(true);
        this.pulseGlow(this.attemptsGlow, 0.3, 0.16, 260);
      }
    } else {
      this.attemptsText.setVisible(false);
      if (this.attemptsGlow) this.attemptsGlow.setVisible(false);
    }
  }

  setDailyAttemptsUsed(value) {
    this.dailyAttemptsUsed = Math.max(0, Math.min(GAME.dailyMaxAttempts, value));
    localStorage.setItem(`taplock_daily_attempts_${this.dailyKey}`, String(this.dailyAttemptsUsed));
    this.updateAttemptsText();
  }

  setDailyBonusUsed(value) {
    this.dailyBonusUsed = !!value;
    localStorage.setItem(`taplock_daily_bonus_used_${this.dailyKey}`, this.dailyBonusUsed ? "1" : "0");
  }

  getTimeUntilMidnightText() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    const diff = Math.max(0, next.getTime() - now.getTime());
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const h = String(hours).padStart(2, "0");
    const m = String(minutes).padStart(2, "0");
    return `${h}:${m}`;
  }

  showDailyLockedOverlay() {
    if (!this.dailyLockOverlay) return;
    if (this.dailyLockTimeoutId) {
      clearTimeout(this.dailyLockTimeoutId);
      this.dailyLockTimeoutId = null;
    }
    this.dailyLockSub.setText(`Next Daily in ${this.getTimeUntilMidnightText()}`);
    this.dailyLockOverlay.setVisible(true);
    this.updateSettingsButtonState();
    this.dailyLockTimeoutId = setTimeout(() => {
      if (this.dailyLockOverlay) this.dailyLockOverlay.setVisible(false);
      this.updateSettingsButtonState();
      this.dailyLockTimeoutId = null;
    }, 1500);
  }

  // Settings + audio/haptics
  loadSettings() {
    const sound = localStorage.getItem("taplock_sound_enabled");
    const haptics = localStorage.getItem("taplock_haptics_enabled");
    this.soundEnabled = sound === null ? true : sound === "1";
    this.hapticsEnabled = haptics === null ? true : haptics === "1";
  }

  setSoundEnabled(value) {
    this.soundEnabled = !!value;
    localStorage.setItem("taplock_sound_enabled", this.soundEnabled ? "1" : "0");
    this.updateSettingsUI();
  }

  setHapticsEnabled(value) {
    this.hapticsEnabled = !!value;
    localStorage.setItem("taplock_haptics_enabled", this.hapticsEnabled ? "1" : "0");
    this.updateSettingsUI();
  }

  updateSettingsUI() {
    if (this.soundToggle) this.soundToggle.setValue(this.soundEnabled);
    if (this.hapticsToggle) this.hapticsToggle.setValue(this.hapticsEnabled);
  }

  createSettingsUI() {
    const { width, height } = this.scale;
    const margin = Math.max(16, Math.min(width, height) * 0.04);
    const gearSize = Math.floor(Math.min(width, height) * 0.05) + "px";
    const glowHex = "#" + this.activeParticleTint.toString(16).padStart(6, "0");

    this.settingsGlow = this.add.text(width - margin, margin, "SET", {
      fontFamily: UI_FONT,
      fontSize: gearSize,
      color: glowHex
    }).setOrigin(0.5).setDepth(11).setAlpha(0.26).setScale(1.15).setBlendMode(Phaser.BlendModes.ADD);

    this.settingsButton = this.add.text(width - margin, margin, "SET", {
      fontFamily: UI_FONT,
      fontSize: gearSize,
      color: "#9aa7c7"
    }).setOrigin(0.5).setDepth(12);

    const pad = Math.max(12, Math.min(width, height) * 0.02);
    const hitArea = new Phaser.Geom.Rectangle(
      -this.settingsButton.width / 2 - pad,
      -this.settingsButton.height / 2 - pad,
      this.settingsButton.width + pad * 2,
      this.settingsButton.height + pad * 2
    );
    this.settingsHitArea = hitArea;
    this.settingsButton.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
    this.settingsButton.isUiElement = true;
    this.settingsButton.on("pointerover", () => {
      this.input.setDefaultCursor("pointer");
      this.settingsButton.setColor("#ffffff");
      if (this.enableExtraGlow && this.settingsGlow) this.settingsGlow.setAlpha(0.36);
    });
    this.settingsButton.on("pointerout", () => {
      this.input.setDefaultCursor("default");
      this.settingsButton.setColor("#9aa7c7");
      if (this.enableExtraGlow && this.settingsGlow) this.settingsGlow.setAlpha(0.26);
    });
    this.settingsButton.on("pointerdown", () => {
      if (this.adPlaying || this.isShowingInterstitial) return;
      this.unlockAudioOnce();
      this.toggleSettingsPanel();
    });

    const panelW = Math.min(width * 0.72, 320);
    const panelH = Math.min(height * 0.28, 190);
    const panelX = width - panelW / 2 - margin;
    const panelY = margin + panelH / 2 + Math.max(8, margin * 0.6);

    this.settingsDim = this.add.rectangle(this.cx, this.cy, width, height, 0x0b0f1a, 0.35)
      .setVisible(false).setDepth(13);

    this.settingsPanel = this.add.container(panelX, panelY).setVisible(false).setDepth(14);

    this.settingsPanelGlow = this.add.rectangle(0, 0, panelW * 1.04, panelH * 1.08, this.activeParticleTint, 0.12)
      .setBlendMode(Phaser.BlendModes.ADD);
    const panelBg = this.add.rectangle(0, 0, panelW, panelH, 0x111a2e, 0.96)
      .setStrokeStyle(2, 0x2a3a6a, 1);
    panelBg.setInteractive(new Phaser.Geom.Rectangle(-panelW / 2, -panelH / 2, panelW, panelH), Phaser.Geom.Rectangle.Contains);
    panelBg.isUiElement = true;
    panelBg.on("pointerdown", () => {});

    this.settingsTitleGlow = this.add.text(0, -panelH * 0.35, "SETTINGS", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: glowHex
    }).setOrigin(0.5).setAlpha(0.24).setScale(1.1).setBlendMode(Phaser.BlendModes.ADD);
    const title = this.add.text(0, -panelH * 0.35, "SETTINGS", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: "#cfe2ff"
    }).setOrigin(0.5);

    const rowH = Math.max(38, panelH * 0.28);
    const rowY1 = -panelH * 0.05;
    const rowY2 = panelH * 0.22;

    this.soundToggle = this.createSettingsToggle("SOUND", rowY1, panelW, rowH);
    this.hapticsToggle = this.createSettingsToggle("HAPTICS", rowY2, panelW, rowH);

    this.soundToggle.bg.on("pointerdown", () => {
      if (this.adPlaying || this.isShowingInterstitial) return;
      this.setSoundEnabled(!this.soundEnabled);
      this.playTapSfx();
      this.vibrate(5);
    });

    this.hapticsToggle.bg.on("pointerdown", () => {
      if (this.adPlaying || this.isShowingInterstitial) return;
      this.setHapticsEnabled(!this.hapticsEnabled);
      this.playTapSfx();
      this.vibrate(5);
    });

    this.settingsPanel.add([
      this.settingsPanelGlow,
      panelBg,
      this.settingsTitleGlow,
      title,
      this.soundToggle.bg,
      this.soundToggle.labelGlow,
      this.soundToggle.labelText,
      this.soundToggle.valueGlow,
      this.soundToggle.valueText,
      this.hapticsToggle.bg,
      this.hapticsToggle.labelGlow,
      this.hapticsToggle.labelText,
      this.hapticsToggle.valueGlow,
      this.hapticsToggle.valueText
    ]);
  }

  createSettingsToggle(label, centerY, panelW, rowH) {
    const rowW = panelW * 0.82;
    const baseFill = 0x1b2740;
    const hoverFill = 0x24365c;
    const fontSize = Math.floor(rowH * 0.42) + "px";
    const glowHex = "#" + this.activeParticleTint.toString(16).padStart(6, "0");

    const bg = this.add.rectangle(0, centerY, rowW, rowH, baseFill, 1)
      .setStrokeStyle(1, 0x2a3a6a, 1);
    bg.setInteractive(new Phaser.Geom.Rectangle(-rowW / 2, -rowH / 2, rowW, rowH), Phaser.Geom.Rectangle.Contains);
    bg.isUiElement = true;

    const labelGlow = this.add.text(-rowW / 2 + rowH * 0.4, centerY, label, {
      fontFamily: UI_FONT,
      fontSize,
      color: glowHex
    }).setOrigin(0, 0.5).setAlpha(0.22).setScale(1.08).setBlendMode(Phaser.BlendModes.ADD);
    const valueGlow = this.add.text(rowW / 2 - rowH * 0.4, centerY, "ON", {
      fontFamily: UI_FONT,
      fontSize,
      color: "#86efac"
    }).setOrigin(1, 0.5).setAlpha(0.22).setScale(1.08).setBlendMode(Phaser.BlendModes.ADD);

    bg.on("pointerover", () => {
      this.input.setDefaultCursor("pointer");
      bg.setFillStyle(hoverFill, 1);
      if (this.enableExtraGlow && labelGlow) labelGlow.setAlpha(0.32);
      if (this.enableExtraGlow && valueGlow) valueGlow.setAlpha(0.32);
    });
    bg.on("pointerout", () => {
      this.input.setDefaultCursor("default");
      bg.setFillStyle(baseFill, 1);
      if (this.enableExtraGlow && labelGlow) labelGlow.setAlpha(0.22);
      if (this.enableExtraGlow && valueGlow) valueGlow.setAlpha(0.22);
    });

    const labelText = this.add.text(-rowW / 2 + rowH * 0.4, centerY, label, {
      fontFamily: UI_FONT,
      fontSize,
      color: "#cfe2ff"
    }).setOrigin(0, 0.5);

    const valueText = this.add.text(rowW / 2 - rowH * 0.4, centerY, "ON", {
      fontFamily: UI_FONT,
      fontSize,
      color: "#86efac"
    }).setOrigin(1, 0.5);

    const setValue = (on) => {
      valueText.setText(on ? "ON" : "OFF");
      valueText.setColor(on ? "#86efac" : "#9aa7c7");
      valueGlow.setText(on ? "ON" : "OFF");
      valueGlow.setColor(on ? "#86efac" : "#9aa7c7");
    };

    return { bg, labelText, labelGlow, valueText, valueGlow, setValue };
  }

  toggleSettingsPanel() {
    if (this.settingsOpen) {
      this.hideSettingsPanel();
    } else {
      this.showSettingsPanel();
    }
  }

  showSettingsPanel() {
    this.settingsOpen = true;
    this.updateSettingsUI();
    if (this.settingsDim) this.settingsDim.setVisible(true);
    if (this.settingsPanel) this.settingsPanel.setVisible(true);
  }

  hideSettingsPanel() {
    this.settingsOpen = false;
    if (this.settingsDim) this.settingsDim.setVisible(false);
    if (this.settingsPanel) this.settingsPanel.setVisible(false);
    this.input.setDefaultCursor("default");
  }

  updateSettingsButtonState() {
    if (!this.settingsButton) return;
    const blocked = this.state === "dead" ||
      (this.overGroup && this.overGroup.visible) ||
      this.adPlaying ||
      this.isShowingInterstitial ||
      (this.dailyLockOverlay && this.dailyLockOverlay.visible);
    if (blocked) {
      this.hideSettingsPanel();
      this.settingsButton.disableInteractive();
      this.settingsButton.setVisible(false);
      if (this.settingsGlow) this.settingsGlow.setVisible(false);
    } else {
      this.settingsButton.setVisible(true);
      if (this.settingsGlow) this.settingsGlow.setVisible(true);
      if (this.settingsHitArea) {
        this.settingsButton.setInteractive(this.settingsHitArea, Phaser.Geom.Rectangle.Contains);
      }
    }
  }

  unlockAudioOnce() {
    if (this.audioUnlocked) return;
    if (this.sound && this.sound.unlock) {
      try { this.sound.unlock(); } catch (e) {}
    }
    const ctx = (this.sound && this.sound.context) ? this.sound.context : null;
    if (ctx) {
      this.audioContext = ctx;
      if (ctx.state === "suspended") {
        try { ctx.resume(); } catch (e) {}
      }
      if (!this.audioMaster) {
        this.audioMaster = ctx.createGain();
        this.audioMaster.gain.value = 0.2;
        this.audioMaster.connect(ctx.destination);
      }
    }
    this.audioUnlocked = true;
  }

  resumeAudioIfNeeded() {
    if (!this.audioUnlocked) return;
    const ctx = this.audioContext || (this.sound && this.sound.context);
    if (ctx && ctx.state === "suspended") {
      try { ctx.resume(); } catch (e) {}
    }
  }

  playTone(freq, durationMs, type, gain, endFreq) {
    if (!this.soundEnabled || !this.audioUnlocked || !this.audioContext || !this.audioMaster) return;
    if (this.adPlaying || this.isShowingInterstitial) return;
    const ctx = this.audioContext;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const now = ctx.currentTime;
    const dur = durationMs / 1000;
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, now + dur);
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(this.audioMaster);
    osc.start(now);
    osc.stop(now + dur);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  playTapSfx() {
    this.playTone(720, 40, "square", 0.05);
  }

  playHitSfx() {
    this.playTone(520, 70, "triangle", 0.07);
  }

  playPerfectSfx() {
    this.playTone(820, 90, "sine", 0.08, 980);
  }

  playMissSfx() {
    this.playTone(180, 130, "sawtooth", 0.08, 120);
  }

  playReviveSfx() {
    this.playTone(320, 110, "sine", 0.07, 520);
  }

  vibrate(pattern) {
    if (!this.hapticsEnabled || !navigator.vibrate) return;
    if (this.adPlaying || this.isShowingInterstitial) return;
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (now - this.lastVibrateAt < 90) return;
    this.lastVibrateAt = now;
    navigator.vibrate(pattern);
  }

  makeModeButton(textObj, mode) {
    const padX = Math.max(16, textObj.width * 0.25);
    const padY = Math.max(10, textObj.height * 0.4);
    const hitArea = new Phaser.Geom.Rectangle(
      -textObj.width / 2 - padX,
      -textObj.height / 2 - padY,
      textObj.width + padX * 2,
      textObj.height + padY * 2
    );
    textObj.isUiElement = true;
    textObj.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
    textObj.on("pointerdown", () => this.setMode(mode));
    textObj.on("pointerover", () => {
      this.input.setDefaultCursor("pointer");
      if (this.mode === mode) return;
      textObj.setColor("#cfd9ff");
    });
    textObj.on("pointerout", () => {
      this.input.setDefaultCursor("default");
      this.updateModeUI();
    });
  }

  setMode(nextMode) {
    if (this.mode === nextMode || this.adPlaying || this.isShowingInterstitial) return;
    this.mode = nextMode;
    this.ensureDailyData();
    this.updateModeUI();
    this.updateBestText();
    this.updateAttemptsText();
    this.resetRound(true);
  }

  createPanelButton(label, width, height) {
    const baseFill = 0x1b2740;
    const hoverFill = 0x24365c;
    const border = 0x2a3a6a;
    const fontSize = Math.floor(height * 0.42) + "px";
    const glowHex = "#" + this.activeParticleTint.toString(16).padStart(6, "0");

    const container = this.add.container(0, 0);
    const bg = this.add.rectangle(0, 0, width, height, baseFill, 1)
      .setStrokeStyle(2, border, 1);
    const glow = this.add.text(0, 0, label, {
      fontFamily: UI_FONT,
      fontSize,
      color: glowHex
    }).setOrigin(0.5).setAlpha(0.22).setScale(1.12).setBlendMode(Phaser.BlendModes.ADD);
    const text = this.add.text(0, 0, label, {
      fontFamily: UI_FONT,
      fontSize,
      color: "#ffffff"
    }).setOrigin(0.5);
    text.isUiElement = true;

    container.add([bg, glow, text]);

    const hitArea = new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height);
    text.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);

    let enabled = true;
    let clickHandler = null;

    const setEnabled = (value) => {
      enabled = value;
      text.setAlpha(enabled ? 1 : 0.45);
      glow.setAlpha(enabled ? 0.22 : 0.08);
      bg.setAlpha(enabled ? 1 : 0.45);
      if (enabled) {
        text.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
      } else {
        text.disableInteractive();
        container.setScale(1);
        bg.setFillStyle(baseFill, 1);
      }
    };

    const setLabel = (nextLabel) => {
      text.setText(nextLabel);
      glow.setText(nextLabel);
    };

    const onClick = (handler) => {
      clickHandler = handler;
    };

    text.on("pointerover", () => {
      if (!enabled) return;
      this.input.setDefaultCursor("pointer");
      bg.setFillStyle(hoverFill, 1);
      if (this.enableExtraGlow) glow.setAlpha(0.32);
      container.setScale(1.03);
    });

    text.on("pointerout", () => {
      if (!enabled) return;
      this.input.setDefaultCursor("default");
      bg.setFillStyle(baseFill, 1);
      if (this.enableExtraGlow) glow.setAlpha(0.22);
      container.setScale(1);
    });

    text.on("pointerdown", () => {
      if (!enabled) return;
      container.setScale(0.98);
      if (clickHandler) clickHandler();
    });

    text.on("pointerup", () => {
      if (!enabled) return;
      container.setScale(1.03);
    });

    return { container, bg, text, glow, setEnabled, setLabel, onClick };
  }

  updateContinueButton() {
    if (!this.continueButton) return;
    const label = this.continueUsed ? "CONTINUE (AD)" : "CONTINUE";
    this.continueButton.setLabel(label);

    const canContinue = !this.continueUsed || !this.adWatchedThisDeath;
    this.continueButton.setEnabled(canContinue && !this.adPlaying);
  }

  onRetry() {
    if (this.state !== "dead" || this.adPlaying || this.isShowingInterstitial) return;
    this.playTapSfx();
    this.vibrate(5);
    if (this.mode === "daily" && this.dailyAttemptsUsed >= GAME.dailyMaxAttempts) {
      this.setMode("classic");
      return;
    }
    this.resetRound(true);
  }

  onContinue() {
    if (this.state !== "dead" || this.adPlaying || this.isShowingInterstitial) return;
    if (this.mode === "daily" && this.dailyAttemptsUsed >= GAME.dailyMaxAttempts) return;
    this.playTapSfx();
    this.vibrate(5);

    if (!this.continueUsed) {
      this.continueUsed = true;
      this.reviveFromContinue();
      return;
    }

    if (this.adWatchedThisDeath) return;

    this.adWatchedThisDeath = true;
    this.updateContinueButton();

    this.showRewardedAdMock().then((success) => {
      if (success) {
        this.reviveFromContinue();
      } else {
        if (this.retryButton) this.retryButton.setEnabled(true);
        this.updateContinueButton();
      }
    });
  }

  reviveFromContinue() {
    if (this.state !== "dead") return;

    this.playReviveSfx();
    this.vibrate([12, 20, 12]);
    this.state = "playing";
    this.overGroup.setVisible(false);
    this.updateSettingsButtonState();
    this.hintText.setVisible(false);
    if (this.hintGlow) this.hintGlow.setVisible(false);

    this.speed = Math.max(this.speed * 0.85, GAME.baseSpeed);
    this.zoneSize = Math.min(this.zoneSize * 1.25, GAME.zoneStartSize);
    const rng = this.mode === "daily" ? this.dailyRng : null;
    this.zoneCenter = this.pickNewZoneCenter(1.2, rng);

    this.ignoreTapUntil = this.time.now + 600;
    this.revivePulse = 1;
    this.cameras.main.flash(120, 210, 235, 255);
  }

  showRewardedAdMock() {
    if (this.adPlaying || this.isShowingInterstitial) return Promise.resolve(false);
    this.adPlaying = true;
    this.hideSettingsPanel();
    this.updateSettingsButtonState();
    if (this.retryButton) this.retryButton.setEnabled(false);
    if (this.continueButton) this.continueButton.setEnabled(false);
    if (this.extraAttemptButton) this.extraAttemptButton.setEnabled(false);

    this.adOverlay.setVisible(true);
    this.adText.setText("WATCHING AD...");

    return new Promise((resolve) => {
      this.time.delayedCall(1200, () => {
        this.adText.setText("AD COMPLETE");
        this.time.delayedCall(400, () => {
          this.adOverlay.setVisible(false);
          this.adPlaying = false;
          this.updateSettingsButtonState();
          resolve(true);
        });
      });
    });
  }

  showInterstitialAdMock() {
    if (this.adPlaying || this.isShowingInterstitial) return Promise.resolve(false);
    this.isShowingInterstitial = true;
    this.adPlaying = true;
    this.hideSettingsPanel();
    this.updateSettingsButtonState();
    if (this.retryButton) this.retryButton.setEnabled(false);
    if (this.continueButton) this.continueButton.setEnabled(false);

    this.adOverlay.setVisible(true);
    this.adText.setText("AD...");

    return new Promise((resolve) => {
      const duration = GAME.interstitialDurationMs;
      const completeDelay = Math.max(160, duration - 200);
      setTimeout(() => {
        if (this.adText) this.adText.setText("AD COMPLETE");
      }, completeDelay);
      setTimeout(() => {
        this.adOverlay.setVisible(false);
        this.isShowingInterstitial = false;
        this.adPlaying = false;
        this.updateSettingsButtonState();
        resolve(true);
      }, duration);
    });
  }

  showGameOverPanel() {
    const bestLabel = this.mode === "daily" ? "Daily Best" : "Best";
    const bestValue = this.mode === "daily" ? this.dailyBest : this.best;
    const dailyLocked = this.mode === "daily" && this.dailyAttemptsUsed >= GAME.dailyMaxAttempts;
    const bonusAvailable = dailyLocked && !this.dailyBonusUsed;
    this.overScore.setText(`Score: ${this.score}`);
    if (this.overScoreGlow) this.overScoreGlow.setText(`Score: ${this.score}`);
    this.overBest.setText(`${bestLabel}: ${bestValue}`);
    if (this.overBestGlow) this.overBestGlow.setText(`${bestLabel}: ${bestValue}`);
    this.overGroup.setVisible(true);
    this.pulseGlow(this.overTitleGlow, 0.3, 0.18, 260);
    this.pulseGlow(this.overScoreGlow, 0.28, 0.16, 240);
    this.pulseGlow(this.overBestGlow, 0.28, 0.16, 240);
    this.pulseGlow(this.overCTAGlow, 0.26, 0.14, 220);
    this.updateSettingsButtonState();
    this.hintText.setVisible(false);
    if (this.hintGlow) this.hintGlow.setVisible(false);
    if (this.adOverlay) this.adOverlay.setVisible(false);
    if (this.retryButton) this.retryButton.setEnabled(true);
    if (this.continueButton) {
      this.continueButton.container.setVisible(!dailyLocked);
      if (!dailyLocked) {
        this.updateContinueButton();
      } else {
        this.continueButton.setEnabled(false);
      }
    }
    if (this.extraAttemptButton) {
      this.extraAttemptButton.container.setVisible(bonusAvailable);
      this.extraAttemptButton.setEnabled(bonusAvailable);
    }
    if (this.shareButton) {
      const showShare = this.mode === "daily";
      this.shareButton.container.setVisible(showShare);
      this.shareButton.setEnabled(showShare);
    }
  }

  onShare() {
    if (this.mode !== "daily" || this.adPlaying || this.isShowingInterstitial) return;
    this.playTapSfx();
    this.vibrate(5);
    const shareText = `TapLock Daily (${this.dailyKey}): ${this.score}. Can you beat me?`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).then(() => {
        this.showToast("COPIED!");
      }).catch(() => {
        window.prompt("Copy this:", shareText);
      });
    } else {
      window.prompt("Copy this:", shareText);
    }
  }

  onExtraAttempt() {
    if (this.mode !== "daily") return;
    if (this.dailyAttemptsUsed < GAME.dailyMaxAttempts) return;
    if (this.dailyBonusUsed) return;
    if (this.adPlaying || this.isShowingInterstitial) return;
    this.playTapSfx();
    this.vibrate(5);

    this.showRewardedAdMock().then((success) => {
      if (!success) {
        if (this.retryButton) this.retryButton.setEnabled(true);
        if (this.continueButton) this.continueButton.setEnabled(true);
        if (this.extraAttemptButton) {
          this.extraAttemptButton.container.setVisible(true);
          this.extraAttemptButton.setEnabled(true);
        }
        return;
      }
      this.setDailyBonusUsed(true);
      this.setDailyAttemptsUsed(this.dailyAttemptsUsed - 1);
      if (this.dailyLockOverlay) this.dailyLockOverlay.setVisible(false);
      this.resetRound(false);
    });
  }

  showToast(message) {
    const toast = this.add.text(this.cx, this.cy - this.r * 0.55, message, {
      fontFamily: UI_FONT,
      fontSize: Math.floor(this.r * 0.18) + "px",
      color: "#ffffff"
    }).setOrigin(0.5).setDepth(25);

    this.tweens.add({
      targets: toast,
      y: toast.y - this.r * 0.1,
      alpha: 0,
      duration: 400,
      ease: "Cubic.Out",
      onComplete: () => toast.destroy()
    });
  }

  getMarkerXY() {
    return {
      x: this.cx + Math.cos(this.angle) * this.r,
      y: this.cy + Math.sin(this.angle) * this.r
    };
  }

  isTapOnRing(pointer) {
    const dx = pointer.x - this.cx;
    const dy = pointer.y - this.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const thickness = Math.max(18, this.r * 0.18);
    return Math.abs(dist - this.r) <= thickness * 0.5;
  }

  isPerfectHit() {
    const dist = this.circularDistance(this.angle, this.zoneCenter);
    return dist <= this.zoneSize * 0.18;
  }

  spawnHitBurst(x, y) {
    if (!this.hitEmitter) return;
    const count = Phaser.Math.Between(10, 16);
    this.hitEmitter.emitParticleAt(x, y, count);
    this.triggerImpactFlash(x, y, 0.9);
  }

  spawnPerfectBurst(x, y) {
    if (!this.perfectEmitter) return;
    const count = Phaser.Math.Between(14, 18);
    this.perfectEmitter.emitParticleAt(x, y, count);
    if (this.missRingEmitter) this.missRingEmitter.emitParticleAt(x, y, 4);
    if (this.perfectRayEmitter) this.perfectRayEmitter.emitParticleAt(x, y, Phaser.Math.Between(10, 14));
    this.triggerImpactFlash(x, y, 1.15);
  }

  spawnMissBurst(x, y) {
    if (this.missEmitter) {
      const count = Phaser.Math.Between(22, 35);
      this.missEmitter.emitParticleAt(x, y, count);
    }
    if (this.missRingEmitter) {
      const ringCount = Phaser.Math.Between(5, 8);
      this.missRingEmitter.emitParticleAt(x, y, ringCount);
    }
  }

  triggerImpactFlash(x, y, scale = 1) {
    this.impactFlashAlpha = 1;
    this.impactFlashX = x;
    this.impactFlashY = y;
    this.impactFlashRadius = this.r * 0.16 * scale;
  }

  triggerPerfectFlash() {
    this.perfectFlashTime = 0;
    this.perfectFlashAlpha = 1;
    this.perfectFlashRadius = this.r * 0.35;
    this.perfectFlashScreenAlpha = 0.35;
  }

  triggerPerfectFeedback() {
    // Tiny slow-mo without breaking input.
    this.time.timeScale = 0.8;
    if (this.perfectSlowMoTimeoutId) {
      clearTimeout(this.perfectSlowMoTimeoutId);
      this.perfectSlowMoTimeoutId = null;
    }
    this.perfectSlowMoTimeoutId = setTimeout(() => {
      this.time.timeScale = 1;
      this.perfectSlowMoTimeoutId = null;
    }, 140);

    this.cameras.main.shake(40, 0.002);
    this.cameras.main.zoomTo(1.02, 80, "Quad.Out", true, (_cam, progress) => {
      if (progress === 1) this.cameras.main.zoomTo(1.0, 120, "Quad.In");
    });
    this.perfectPulse = 1;
    this.triggerPerfectFlash();

    const popup = this.add.text(this.cx, this.cy - this.r * 0.15, "PERFECT", {
      fontFamily: UI_FONT,
      fontSize: Math.floor(this.r * 0.22) + "px",
      color: "#ffffff"
    }).setOrigin(0.5).setDepth(8);

    this.tweens.add({
      targets: popup,
      y: popup.y - this.r * 0.12,
      alpha: 0,
      duration: 450,
      ease: "Cubic.Out",
      onComplete: () => popup.destroy()
    });
  }

  isPointerOverUI(currentlyOver) {
    if (currentlyOver && currentlyOver.length) {
      for (let i = 0; i < currentlyOver.length; i++) {
        const obj = currentlyOver[i];
        if (obj && obj.isUiElement) return true;
      }
    }
    return false;
  }

  onTap(pointer, currentlyOver) {
    this.unlockAudioOnce();
    const uiHit = this.isPointerOverUI(currentlyOver) || this.uiPointerDown;
    this.uiPointerDown = false;
    if (uiHit) return;
    if (this.settingsOpen) {
      this.hideSettingsPanel();
      return;
    }
    if (this.adPlaying || this.isShowingInterstitial) return;

    if (this.state === "ready") {
      if (this.dailyLockOverlay && this.dailyLockOverlay.visible) return;
      if (this.overGroup && this.overGroup.visible) return;
      if (this.isTapOnRing(pointer)) {
        this.cycleSkin();
        return;
      }
      if (this.mode === "daily") {
        const changed = this.ensureDailyData();
        if (changed) {
          this.updateBestText();
          this.updateAttemptsText();
          this.resetRound(true);
        }
        if (this.dailyAttemptsUsed >= GAME.dailyMaxAttempts) {
          this.showDailyLockedOverlay();
          return;
        }
      }
      this.playTapSfx();
      this.vibrate(5);
      this.state = "playing";
      this.hintText.setVisible(false);
      if (this.hintGlow) this.hintGlow.setVisible(false);
      return;
    }

    if (this.state === "dead") return;

    if (this.state !== "playing") return;
    if (this.ignoreTapUntil && this.time.now < this.ignoreTapUntil) return;

    const hit = this.isMarkerInZone();

    if (hit) {
      const { x, y } = this.getMarkerXY();
      const perfect = this.isPerfectHit();

      if (perfect) {
        this.spawnPerfectBurst(x, y);
        this.triggerPerfectFeedback();
        this.playPerfectSfx();
        this.vibrate([8, 30, 8]);
      } else {
        this.spawnHitBurst(x, y);
        this.playHitSfx();
        this.vibrate(10);
      }

      this.score += 1;
      if (this.centerScoreText) this.centerScoreText.setText(String(this.score));
      if (this.centerScoreGlow) this.centerScoreGlow.setText(String(this.score));
      this.tweens.add({
        targets: this.centerScoreText,
        scale: 1.08,
        duration: 90,
        yoyo: true,
        ease: "Quad.Out"
      });
      this.pulseGlow(this.centerScoreGlow, 0.46, 0.22, 240);
      this.cameras.main.shake(60, 0.003);

      this.speed = GAME.baseSpeed + this.score * GAME.speedGain;
      this.zoneSize = Math.max(GAME.zoneMinSize, GAME.zoneStartSize - this.score * GAME.zoneShrink);
      const rng = this.mode === "daily" ? this.dailyRng : null;
      this.zoneCenter = this.pickNewZoneCenter(0.9, rng);
      if (this.score >= 10 && this.score % 5 === 0) this.dir *= -1;
    } else {
      this.die();
    }
  }

  die() {
    const { x, y } = this.getMarkerXY();
    this.state = "dead";
    this.updateSettingsButtonState();
    this.deathsThisSession += 1;
    this.playMissSfx();
    this.vibrate([30]);
    this.adWatchedThisDeath = false;
    this.ignoreTapUntil = 0;
    this.time.timeScale = 1;
    if (this.perfectSlowMoTimeoutId) {
      clearTimeout(this.perfectSlowMoTimeoutId);
      this.perfectSlowMoTimeoutId = null;
    }

    if (this.mode === "daily") {
      if (this.score > this.dailyBest) {
        this.dailyBest = this.score;
        localStorage.setItem(`taplock_daily_best_${this.dailyKey}`, String(this.dailyBest));
      }
      if (this.dailyAttemptsUsed < GAME.dailyMaxAttempts) {
        this.setDailyAttemptsUsed(this.dailyAttemptsUsed + 1);
      }
    } else if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem("taplock_best", String(this.best));
      this.checkSkinUnlocks();
    }
    this.updateBestText();

    const cooldownOk = GAME.interstitialCooldownDeaths <= 0 ||
      (this.deathsThisSession - this.lastInterstitialDeathCount >= GAME.interstitialCooldownDeaths);
    const shouldShowInterstitial =
      this.deathsThisSession >= GAME.interstitialMinDeathsBeforeFirst &&
      this.deathsThisSession % GAME.interstitialEveryDeaths === 0 &&
      this.score >= GAME.interstitialMinScoreToShow &&
      !this.adWatchedThisDeath &&
      !this.adPlaying &&
      cooldownOk;

    this.overGroup.setVisible(false);
    if (this.retryButton) this.retryButton.setEnabled(false);
    if (this.continueButton) this.continueButton.setEnabled(false);

    this.spawnMissBurst(x, y);
    this.cameras.main.shake(120, 0.01);

    if (shouldShowInterstitial) {
      this.lastInterstitialDeathCount = this.deathsThisSession;
      this.showInterstitialAdMock().then(() => {
        this.showGameOverPanel();
      });
    } else {
      this.showGameOverPanel();
    }
  }

  isMarkerInZone() {
    const a = this.normAngle(this.angle);
    const half = this.zoneSize / 2;

    const start = this.normAngle(this.zoneCenter - half);
    const end = this.normAngle(this.zoneCenter + half);

    const g = GAME.grace;

    if (start <= end) {
      return a >= (start - g) && a <= (end + g);
    } else {
      return a >= (start - g) || a <= (end + g);
    }
  }

  pickNewZoneCenter(minDistance = 0.9, rng = null) {
    const tries = 12;
    for (let i = 0; i < tries; i++) {
      const c = rng ? rng() * Math.PI * 2 : Phaser.Math.FloatBetween(0, Math.PI * 2);
      const d = this.circularDistance(c, this.angle);
      if (d > minDistance) return c;
    }
    return rng ? rng() * Math.PI * 2 : Phaser.Math.FloatBetween(0, Math.PI * 2);
  }

  circularDistance(a, b) {
    const x = this.normAngle(a);
    const y = this.normAngle(b);
    let d = Math.abs(x - y);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d;
  }

  normAngle(a) {
    let x = a % (Math.PI * 2);
    if (x < 0) x += Math.PI * 2;
    return x;
  }

  update(time, delta) {
    const dt = delta / 1000;

    if (this.state === "playing") {
      this.angle += this.dir * this.speed * dt;
    }

    this.ringPulse = 0.5 + 0.5 * Math.sin(this.time.now * 0.0012);
    this.bgShift += delta * 0.00008;
    if (this.perfectPulse > 0) {
      this.perfectPulse = Math.max(0, this.perfectPulse - delta / 400);
    }

    if (this.revivePulse > 0) {
      this.revivePulse = Math.max(0, this.revivePulse - dt / 0.4);
    }

    if (this.impactFlashAlpha > 0) {
      this.impactFlashAlpha = Math.max(0, this.impactFlashAlpha - delta / 180);
    }
    if (this.perfectFlashTime < this.perfectFlashDuration) {
      this.perfectFlashTime = Math.min(this.perfectFlashDuration, this.perfectFlashTime + delta);
      const t = this.perfectFlashTime / this.perfectFlashDuration;
      this.perfectFlashAlpha = 1 - t;
      this.perfectFlashRadius = Phaser.Math.Linear(this.r * 0.3, this.r * 0.5, t);
      this.perfectFlashScreenAlpha = 0.4 * (1 - t);
    } else {
      this.perfectFlashAlpha = 0;
      this.perfectFlashScreenAlpha = 0;
    }

    if (this.bgImg) {
      const drift = 0.004;
      this.bgImg.x = this.cx + Math.cos(this.time.now * 0.00012) * (this.scale.width * drift);
      this.bgImg.y = this.cy + Math.sin(this.time.now * 0.0001) * (this.scale.height * drift);
    }
    if (this.bgImgFar) {
      const drift = 0.002;
      this.bgImgFar.x = this.cx + Math.cos(this.time.now * 0.00008) * (this.scale.width * drift);
      this.bgImgFar.y = this.cy + Math.sin(this.time.now * 0.00007) * (this.scale.height * drift);
    }
    if (this.bgImgBloom) {
      const drift = 0.006;
      this.bgImgBloom.x = this.cx + Math.cos(this.time.now * 0.00016) * (this.scale.width * drift);
      this.bgImgBloom.y = this.cy + Math.sin(this.time.now * 0.00014) * (this.scale.height * drift);
      this.bgImgBloom.setAlpha(0.14 + this.ringPulse * 0.08);
    }

    if (this.enableExtraGlow && this.ringAura) {
      const auraPulse = 1 + this.ringPulse * 0.06 + this.perfectPulse * 0.08;
      this.ringAura.setPosition(this.cx, this.cy);
      this.ringAura.setScale(this.ringAuraBaseScale * auraPulse);
      this.ringAura.setAlpha(0.16 + this.ringPulse * 0.1 + this.perfectPulse * 0.2);
    }
    if (this.enableExtraGlow && this.ringHalo) {
      const haloPulse = 1 + this.ringPulse * 0.08;
      this.ringHalo.setPosition(this.cx, this.cy);
      this.ringHalo.setScale(this.ringHaloBaseScale * haloPulse);
      this.ringHalo.setAlpha(0.1 + this.ringPulse * 0.08);
    }
    if (this.flashSprite) {
      if (this.perfectFlashAlpha > 0) {
        const t = this.perfectFlashTime / this.perfectFlashDuration;
        const scale = this.flashBaseScale * Phaser.Math.Linear(0.7, 1.05, t);
        this.flashSprite.setPosition(this.cx, this.cy);
        this.flashSprite.setScale(scale);
        this.flashSprite.setAlpha(0.7 * this.perfectFlashAlpha);
      } else {
        this.flashSprite.setAlpha(0);
      }
    }

    if (this.screenFlash) {
      this.screenFlash.setAlpha(this.perfectFlashScreenAlpha);
    }

    if (this.hintText && this.state === "ready") {
      const hintPulse = 0.5 + 0.5 * Math.sin(this.time.now * 0.004);
      this.hintText.setAlpha(hintPulse);
      if (this.enableExtraGlow && this.hintGlow) this.hintGlow.setAlpha(0.18 + hintPulse * 0.25);
    }

    this.draw();
  }

  draw() {
    if (this.gRingGlow) this.gRingGlow.clear();
    if (this.gRingCore) this.gRingCore.clear();
    if (this.gZone) this.gZone.clear();
    if (this.gMarker) this.gMarker.clear();
    if (this.gImpact) this.gImpact.clear();

    this.drawRingLayers();

    // Revive pulse ring
    if (this.revivePulse > 0 && this.gRingGlow) {
      const pulse = this.revivePulse;
      const pulseR = this.r * (1 + (1 - pulse) * 0.12);
      this.gRingGlow.lineStyle(Math.max(4, this.r * 0.04), 0x8ec7ff, 0.6 * pulse);
      this.gRingGlow.beginPath();
      this.gRingGlow.arc(this.cx, this.cy, pulseR, 0, Math.PI * 2);
      this.gRingGlow.strokePath();
    }

    // Perfect ripple
    if (this.perfectPulse > 0 && this.gRingGlow) {
      const pulseR = this.r * (1 + (1 - this.perfectPulse) * 0.15);
      this.gRingGlow.lineStyle(Math.max(5, this.r * 0.05), 0x8ec7ff, 0.5 * this.perfectPulse);
      this.gRingGlow.beginPath();
      this.gRingGlow.arc(this.cx, this.cy, pulseR, 0, Math.PI * 2);
      this.gRingGlow.strokePath();
    }

    // Marker position
    const mx = this.cx + Math.cos(this.angle) * this.r;
    const my = this.cy + Math.sin(this.angle) * this.r;

    this.gMarker.fillStyle(0xffffff, 0.12);
    this.gMarker.fillCircle(mx, my, this.rMarker * 2.2);
    this.gMarker.fillStyle(0xffffff, 1);
    this.gMarker.fillCircle(mx, my, this.rMarker);

    // Trail
    this.gMarker.fillStyle(0xffffff, 0.15);
    this.gMarker.fillCircle(
      this.cx + Math.cos(this.angle - this.dir * 0.14) * this.r,
      this.cy + Math.sin(this.angle - this.dir * 0.14) * this.r,
      this.rMarker * 0.8
    );

    if (this.gImpact && this.perfectFlashAlpha > 0) {
      this.gImpact.fillStyle(0xffffff, 0.9 * this.perfectFlashAlpha);
      this.gImpact.fillCircle(this.cx, this.cy, this.perfectFlashRadius);
    }
    if (this.gImpact && this.impactFlashAlpha > 0) {
      this.gImpact.fillStyle(this.activeGlowEnd, 0.45 * this.impactFlashAlpha);
      this.gImpact.fillCircle(this.impactFlashX, this.impactFlashY, this.impactFlashRadius);
    }
  }
}

const config = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#0b0f1a",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  fps: {
    target: 60,
    forceSetTimeOut: true
  },
  scene: [TapLockScene]
};

new Phaser.Game(config);
