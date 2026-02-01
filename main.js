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
  }

  create() {
    const { width, height } = this.scale;

    this.cx = width / 2;
    this.cy = height / 2;
    this.r = Math.min(width, height) * 0.28;
    this.rMarker = this.r * 0.06;

    this.add.rectangle(this.cx, this.cy, width, height, 0x0b0f1a).setDepth(-10);

    this.gRing = this.add.graphics();
    this.gZone = this.add.graphics();
    this.gMarker = this.add.graphics();

    this.loadSettings();

    // Particle textures + emitters (generated, no assets)
    if (!this.textures.exists("p_dot") || !this.textures.exists("p_ring")) {
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
      lifespan: { min: 200, max: 350 },
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
      alpha: { start: 0.95, end: 0 }
    }).setDepth(6);

    this.missRingEmitter = this.add.particles(0, 0, "p_ring", {
      emitting: false,
      lifespan: { min: 300, max: 560 },
      speed: { min: 90, max: 190 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 0.7, end: 0 },
      blendMode: "ADD"
    }).setDepth(6);

    this.scoreText = this.add.text(this.cx, this.cy - this.r * 1.55, "0", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: Math.floor(Math.min(width, height) * 0.07) + "px",
      color: "#ffffff"
    }).setOrigin(0.5);

    this.bestText = this.add.text(this.cx, this.cy - this.r * 1.25, "BEST 0", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: "#9aa7c7"
    }).setOrigin(0.5);

    this.attemptsText = this.add.text(this.cx, this.bestText.y + this.r * 0.22, "ATTEMPTS: 0 / 3", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: Math.floor(Math.min(width, height) * 0.026) + "px",
      color: "#9aa7c7"
    }).setOrigin(0.5).setVisible(false);

    const modeFontSize = Math.floor(Math.min(width, height) * 0.026) + "px";
    const modeY = this.bestText.y - this.r * 0.34;
    this.modeClassicText = this.add.text(0, modeY, "CLASSIC", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: modeFontSize,
      color: "#ffffff"
    }).setOrigin(0.5);
    this.modeDailyText = this.add.text(0, modeY, "DAILY", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: modeFontSize,
      color: "#9aa7c7"
    }).setOrigin(0.5);

    const modeGap = Math.max(14, this.r * 0.14);
    const modeTotalWidth = this.modeClassicText.width + this.modeDailyText.width + modeGap;
    this.modeClassicText.setX(this.cx - modeTotalWidth / 2 + this.modeClassicText.width / 2);
    this.modeDailyText.setX(this.cx + modeTotalWidth / 2 - this.modeDailyText.width / 2);
    this.makeModeButton(this.modeClassicText, "classic");
    this.makeModeButton(this.modeDailyText, "daily");

    this.hintText = this.add.text(this.cx, this.cy + this.r * 1.55, "TAP TO START", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: "#9aa7c7"
    }).setOrigin(0.5);

    this.createSettingsUI();

    // Game over overlay
    this.overGroup = this.add.container(0, 0).setVisible(false).setDepth(10);
    const panelW = Math.min(width * 0.84, 420);
    const panelH = Math.min(height * 0.42, 320);

    const panel = this.add.rectangle(this.cx, this.cy, panelW, panelH, 0x111a2e, 0.92)
      .setStrokeStyle(2, 0x2a3a6a, 1);

    this.overTitle = this.add.text(this.cx, this.cy - panelH * 0.24, "GAME OVER", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: Math.floor(Math.min(width, height) * 0.04) + "px",
      color: "#ffffff"
    }).setOrigin(0.5);

    this.overScore = this.add.text(this.cx, this.cy - panelH * 0.02, "Score: 0", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: "#cfe2ff"
    }).setOrigin(0.5);

    this.overBest = this.add.text(this.cx, this.cy + panelH * 0.10, "Best: 0", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: Math.floor(Math.min(width, height) * 0.03) + "px",
      color: "#cfe2ff"
    }).setOrigin(0.5);

    this.overCTA = this.add.text(this.cx, this.cy + panelH * 0.18, "CHOOSE", {
      fontFamily: "Arial, system-ui, -apple-system",
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
      this.overTitle,
      this.overScore,
      this.overBest,
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
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: Math.floor(Math.min(width, height) * 0.04) + "px",
      color: "#ffffff"
    }).setOrigin(0.5);
    this.adOverlay.add([adBg, this.adText]);

    // Daily attempts lock overlay
    this.dailyLockOverlay = this.add.container(0, 0).setVisible(false).setDepth(25);
    const lockBg = this.add.rectangle(this.cx, this.cy, width, height, 0x0b0f1a, 0.8);
    this.dailyLockTitle = this.add.text(this.cx, this.cy - this.r * 0.1, "NO ATTEMPTS LEFT", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize: Math.floor(Math.min(width, height) * 0.04) + "px",
      color: "#ffffff"
    }).setOrigin(0.5);
    this.dailyLockSub = this.add.text(this.cx, this.cy + this.r * 0.06, "Next Daily in 00:00", {
      fontFamily: "Arial, system-ui, -apple-system",
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
    this.updateModeUI();
    this.updateAttemptsText();
    this.updateSettingsUI();

    this.resetRound(true);

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
    this.adPlaying = false;
    this.isShowingInterstitial = false;
    this.time.timeScale = 1;
    if (this.perfectSlowMoTimeoutId) {
      clearTimeout(this.perfectSlowMoTimeoutId);
      this.perfectSlowMoTimeoutId = null;
    }

    this.scoreText.setText("0");
    this.updateBestText();
    this.updateAttemptsText();
    this.hintText.setVisible(showHint);
    this.overGroup.setVisible(false);
    if (this.adOverlay) this.adOverlay.setVisible(false);
    if (this.dailyLockOverlay) this.dailyLockOverlay.setVisible(false);
    if (this.retryButton) this.retryButton.setEnabled(true);
    if (this.continueButton) this.updateContinueButton();
    this.hideSettingsPanel();

    this.cameras.main.flash(80, 255, 255, 255);
  }

  // Daily mode helpers (date key + seeded RNG)
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

  updateBestText() {
    if (this.mode === "daily") {
      this.bestText.setText(`DAILY BEST ${this.dailyBest}`);
    } else {
      this.bestText.setText(`BEST ${this.best}`);
    }
  }

  updateModeUI() {
    const classicActive = this.mode === "classic";
    if (this.modeClassicText) {
      this.modeClassicText.setColor(classicActive ? "#ffffff" : "#6f7aa6");
      this.modeClassicText.setAlpha(classicActive ? 1 : 0.8);
    }
    if (this.modeDailyText) {
      this.modeDailyText.setColor(classicActive ? "#6f7aa6" : "#ffffff");
      this.modeDailyText.setAlpha(classicActive ? 0.8 : 1);
    }
  }

  updateAttemptsText() {
    if (!this.attemptsText) return;
    if (this.mode === "daily") {
      this.attemptsText.setText(`ATTEMPTS: ${this.dailyAttemptsUsed} / ${GAME.dailyMaxAttempts}`);
      this.attemptsText.setVisible(true);
    } else {
      this.attemptsText.setVisible(false);
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
    this.dailyLockTimeoutId = setTimeout(() => {
      if (this.dailyLockOverlay) this.dailyLockOverlay.setVisible(false);
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

    this.settingsButton = this.add.text(width - margin, margin, "SET", {
      fontFamily: "Arial, system-ui, -apple-system",
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
    this.settingsButton.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
    this.settingsButton.isUiElement = true;
    this.settingsButton.on("pointerover", () => {
      this.input.setDefaultCursor("pointer");
      this.settingsButton.setColor("#ffffff");
    });
    this.settingsButton.on("pointerout", () => {
      this.input.setDefaultCursor("default");
      this.settingsButton.setColor("#9aa7c7");
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

    const panelBg = this.add.rectangle(0, 0, panelW, panelH, 0x111a2e, 0.96)
      .setStrokeStyle(2, 0x2a3a6a, 1);
    panelBg.setInteractive(new Phaser.Geom.Rectangle(-panelW / 2, -panelH / 2, panelW, panelH), Phaser.Geom.Rectangle.Contains);
    panelBg.isUiElement = true;
    panelBg.on("pointerdown", () => {});

    const title = this.add.text(0, -panelH * 0.35, "SETTINGS", {
      fontFamily: "Arial, system-ui, -apple-system",
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
      panelBg,
      title,
      this.soundToggle.bg,
      this.soundToggle.labelText,
      this.soundToggle.valueText,
      this.hapticsToggle.bg,
      this.hapticsToggle.labelText,
      this.hapticsToggle.valueText
    ]);
  }

  createSettingsToggle(label, centerY, panelW, rowH) {
    const rowW = panelW * 0.82;
    const baseFill = 0x1b2740;
    const hoverFill = 0x24365c;
    const fontSize = Math.floor(rowH * 0.42) + "px";

    const bg = this.add.rectangle(0, centerY, rowW, rowH, baseFill, 1)
      .setStrokeStyle(1, 0x2a3a6a, 1);
    bg.setInteractive(new Phaser.Geom.Rectangle(-rowW / 2, -rowH / 2, rowW, rowH), Phaser.Geom.Rectangle.Contains);
    bg.isUiElement = true;
    bg.on("pointerover", () => {
      this.input.setDefaultCursor("pointer");
      bg.setFillStyle(hoverFill, 1);
    });
    bg.on("pointerout", () => {
      this.input.setDefaultCursor("default");
      bg.setFillStyle(baseFill, 1);
    });

    const labelText = this.add.text(-rowW / 2 + rowH * 0.4, centerY, label, {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize,
      color: "#cfe2ff"
    }).setOrigin(0, 0.5);

    const valueText = this.add.text(rowW / 2 - rowH * 0.4, centerY, "ON", {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize,
      color: "#86efac"
    }).setOrigin(1, 0.5);

    const setValue = (on) => {
      valueText.setText(on ? "ON" : "OFF");
      valueText.setColor(on ? "#86efac" : "#9aa7c7");
    };

    return { bg, labelText, valueText, setValue };
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

    const container = this.add.container(0, 0);
    const bg = this.add.rectangle(0, 0, width, height, baseFill, 1)
      .setStrokeStyle(2, border, 1);
    const text = this.add.text(0, 0, label, {
      fontFamily: "Arial, system-ui, -apple-system",
      fontSize,
      color: "#ffffff"
    }).setOrigin(0.5);
    text.isUiElement = true;

    container.add([bg, text]);

    const hitArea = new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height);
    text.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);

    let enabled = true;
    let clickHandler = null;

    const setEnabled = (value) => {
      enabled = value;
      text.setAlpha(enabled ? 1 : 0.45);
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
    };

    const onClick = (handler) => {
      clickHandler = handler;
    };

    text.on("pointerover", () => {
      if (!enabled) return;
      this.input.setDefaultCursor("pointer");
      bg.setFillStyle(hoverFill, 1);
      container.setScale(1.03);
    });

    text.on("pointerout", () => {
      if (!enabled) return;
      this.input.setDefaultCursor("default");
      bg.setFillStyle(baseFill, 1);
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

    return { container, bg, text, setEnabled, setLabel, onClick };
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
    this.hintText.setVisible(false);

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
    this.overBest.setText(`${bestLabel}: ${bestValue}`);
    this.overGroup.setVisible(true);
    this.hintText.setVisible(false);
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
      fontFamily: "Arial, system-ui, -apple-system",
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

  isPerfectHit() {
    const dist = this.circularDistance(this.angle, this.zoneCenter);
    return dist <= this.zoneSize * 0.18;
  }

  spawnHitBurst(x, y) {
    if (!this.hitEmitter) return;
    const count = Phaser.Math.Between(10, 16);
    this.hitEmitter.emitParticleAt(x, y, count);
  }

  spawnPerfectBurst(x, y) {
    if (!this.perfectEmitter) return;
    const count = Phaser.Math.Between(14, 18);
    this.perfectEmitter.emitParticleAt(x, y, count);
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

    const popup = this.add.text(this.cx, this.cy - this.r * 0.15, "PERFECT", {
      fontFamily: "Arial, system-ui, -apple-system",
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
      this.scoreText.setText(String(this.score));
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

    if (this.revivePulse > 0) {
      this.revivePulse = Math.max(0, this.revivePulse - dt / 0.4);
    }

    this.draw();
  }

  draw() {
    this.gRing.clear();
    this.gZone.clear();
    this.gMarker.clear();

    // Ring
    this.gRing.lineStyle(Math.max(6, this.r * 0.06), 0x23304f, 1);
    this.gRing.beginPath();
    this.gRing.arc(this.cx, this.cy, this.r, 0, Math.PI * 2);
    this.gRing.strokePath();

    // Revive pulse ring
    if (this.revivePulse > 0) {
      const pulse = this.revivePulse;
      const pulseR = this.r * (1 + (1 - pulse) * 0.12);
      this.gRing.lineStyle(Math.max(4, this.r * 0.04), 0x8ec7ff, 0.6 * pulse);
      this.gRing.beginPath();
      this.gRing.arc(this.cx, this.cy, pulseR, 0, Math.PI * 2);
      this.gRing.strokePath();
    }

    // Zone arc (glowing)
    const half = this.zoneSize / 2;
    const zStart = this.zoneCenter - half;
    const zEnd = this.zoneCenter + half;

    // Outer glow
    this.gZone.lineStyle(Math.max(10, this.r * 0.09), 0x3b82f6, 0.18);
    this.gZone.beginPath();
    this.gZone.arc(this.cx, this.cy, this.r, zStart, zEnd);
    this.gZone.strokePath();

    // Core zone
    this.gZone.lineStyle(Math.max(6, this.r * 0.06), 0x60a5fa, 0.95);
    this.gZone.beginPath();
    this.gZone.arc(this.cx, this.cy, this.r, zStart, zEnd);
    this.gZone.strokePath();

    // Marker position
    const mx = this.cx + Math.cos(this.angle) * this.r;
    const my = this.cy + Math.sin(this.angle) * this.r;

    this.gMarker.fillStyle(0xffffff, 1);
    this.gMarker.fillCircle(mx, my, this.rMarker);

    // Trail
    this.gMarker.fillStyle(0xffffff, 0.15);
    this.gMarker.fillCircle(
      this.cx + Math.cos(this.angle - this.dir * 0.14) * this.r,
      this.cy + Math.sin(this.angle - this.dir * 0.14) * this.r,
      this.rMarker * 0.8
    );
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
