import { _decorator, Component, AudioSource, AudioClip } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { GameData } from '../data/GameData';
import { JackpotType, SpinResponse } from '../data/SlotTypes';
import { SpeedMode } from './AutoSpinManager';
import { Log } from '../core/Logger';

const { ccclass, property } = _decorator;

type ReelStoppedPayload = number | { reelIndex: number; result?: unknown };
type StickyCellLike = { symbolId?: number; credit?: number };

@ccclass('SoundManager')
export class SoundManager extends Component {
    private static _instance: SoundManager | null = null;
    static get instance(): SoundManager | null { return SoundManager._instance; }

    @property({ type: AudioSource })
    bgmSource: AudioSource | null = null;

    @property({ type: AudioSource })
    sfxSource: AudioSource | null = null;

    @property({ type: AudioSource })
    coinSource: AudioSource | null = null;

    @property({ type: AudioSource })
    ambienceSource: AudioSource | null = null;

    @property({ type: AudioSource })
    bgmCrossfadeSource: AudioSource | null = null;

    @property({ type: AudioClip }) mxNormalIntro: AudioClip | null = null;
    @property({ type: AudioClip }) mxNormalLoop: AudioClip | null = null;
    @property({ type: AudioClip }) mxBonusIdle: AudioClip | null = null;
    @property({ type: AudioClip }) mxBonusLoop: AudioClip | null = null;
    @property({ type: AudioClip }) mxBonusCongratulation: AudioClip | null = null;
    @property({ type: AudioClip }) mxProgressiveWin: AudioClip | null = null;
    @property({ type: AudioClip }) mxProgressiveWinSkip: AudioClip | null = null;
    @property({ type: AudioClip }) mxGrandJackpotWin: AudioClip | null = null;
    @property({ type: AudioClip }) mxMajorJackpotWin: AudioClip | null = null;
    @property({ type: AudioClip }) mxMinorJackpotWin: AudioClip | null = null;
    @property({ type: AudioClip }) mxMiniJackpotWin: AudioClip | null = null;

    @property({ type: AudioClip }) sxAmbience: AudioClip | null = null;
    @property({ type: AudioClip }) sxUiClick: AudioClip | null = null;
    @property({ type: AudioClip }) sxReelSpin: AudioClip | null = null;
    @property({ type: AudioClip }) sxReelSpinQuickTurbo: AudioClip | null = null;
    @property({ type: AudioClip }) sxReelLand1: AudioClip | null = null;
    @property({ type: AudioClip }) sxReelLand2: AudioClip | null = null;
    @property({ type: AudioClip }) sxReelLand3: AudioClip | null = null;
    @property({ type: AudioClip }) sxReelLand4: AudioClip | null = null;
    @property({ type: AudioClip }) sxReelLand5: AudioClip | null = null;
    @property({ type: AudioClip }) sxReelLandAll: AudioClip | null = null;
    @property({ type: AudioClip }) sxSelectAFeature: AudioClip | null = null;
    @property({ type: AudioClip }) sxFeatureSelect: AudioClip | null = null;
    @property({ type: AudioClip }) sxSymbolMatchLowValue: AudioClip | null = null;
    @property({ type: AudioClip }) sxSymbolMatchHighValue: AudioClip | null = null;
    @property({ type: AudioClip }) sxSymbolPayout: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusTrigger: AudioClip | null = null;
    @property({ type: AudioClip }) sxPotEffectLvl2: AudioClip | null = null;
    @property({ type: AudioClip }) sxPotEffectLvl3: AudioClip | null = null;
    @property({ type: AudioClip }) sxPotEffectLvl4: AudioClip | null = null;
    @property({ type: AudioClip }) sxPotEffectLvl5: AudioClip | null = null;
    @property({ type: AudioClip }) sxPotEffectLvl6: AudioClip | null = null;
    @property({ type: AudioClip }) sxPotTrailWhoosh: AudioClip | null = null;
    @property({ type: AudioClip }) sxPotHit: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusSelectMini: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusSelectMinor: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusSelectMajor: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusSelectGrand: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusJpWin: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusFakeTrigger: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusTrail: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusStickyLand: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusStickyLand2: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusStickyLand3: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusStickyLand4: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusStickyLand5: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusStickyGoldLand: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusStickyGoldIncreaseHit: AudioClip | null = null;
    @property({ type: AudioClip }) sxBonusStickyWin: AudioClip | null = null;
    @property({ type: AudioClip }) sxTransition: AudioClip | null = null;
    @property({ type: AudioClip }) sxCounterLoop: AudioClip | null = null;
    @property({ type: AudioClip }) sxCounterEnd: AudioClip | null = null;
    @property({ type: AudioClip }) sxPlus1Spin: AudioClip | null = null;
    @property({ type: AudioClip }) sxGirlSymbolAnim: AudioClip | null = null;
    @property({ type: AudioClip }) sxBannerDisappear: AudioClip | null = null;

    @property({ range: [0, 1, 0.05], slide: true })
    bgmVolume = 0.5;

    @property({ range: [0, 1, 0.05], slide: true })
    sfxVolume = 1.0;

    @property({ range: [0, 1, 0.05], slide: true })
    ambienceVolume = 0.3;

    @property({ min: 0, max: 10000, step: 100 })
    introToLoopDelayMs = 3000;

    @property({ min: 0, max: 1000, step: 50 })
    bgmFadeOutDurationMs = 300;

    private _masterMuted = false;
    private _bgmMuted = false;
    private _sfxMuted = false;
    private _speedMode: SpeedMode = SpeedMode.NORMAL;
    private _introTriggered = false;
    private _inFeatureMusic = false;
    private _turboLandPlayed = false;
    private _coinLoopActive = false;
    private _bgmFadeTick: (() => void) | null = null;
    private _bonusLoopCallback: (() => void) | null = null;
    private _transitionSoundPlayed: boolean = false;
    private _featureSelectSoundPlayed: boolean = false;
    private _stickyLandCount: number = 0;
    private _stickyWinSoundPlayedThisSpin: boolean = false;

    onLoad(): void {
        SoundManager._instance = this;
        Log.enable('coinloop');
        this._loadMuteSettings();
        const game = (window as any).cc?.game || (window as any).cc?.Game;
        if (game?.addPersistRootNode) {
            game.addPersistRootNode(this.node);
        } else {
            this.node.parent?.setParent(null);
        }
        this._bindEvents();
    }

    onDestroy(): void {
        if (SoundManager._instance === this) SoundManager._instance = null;
        this._removeBonusLoopCallback();
        this.unscheduleAllCallbacks();
        EventBus.instance.offTarget(this);
    }

    private _bindEvents(): void {
        const bus = EventBus.instance;

        bus.on(GameEvents.GAME_READY, this._onGameReady, this);
        bus.on(GameEvents.GUIDE_COMPLETE, this._onGameEntryEffect, this);
        bus.on(GameEvents.GAME_ENTRY_EFFECT, this._onGameEntryEffect, this);

        bus.on(GameEvents.SPEED_MODE_CHANGED, this._onSpeedModeChanged, this);
        bus.on(GameEvents.REELS_START_SPIN, this._onSpinStart, this);
        bus.on(GameEvents.REEL_STOPPED, this._onReelStopped, this);
        bus.on(GameEvents.LONG_SPIN_VFX_START, this._onLongSpinTriggered, this);
        bus.on(GameEvents.WIN_PRESENT_START,     this._onWinPresentStart,   this);

        bus.on(GameEvents.PROGRESSIVE_WIN_SHOW, this._onProgressiveWinShow, this);
        bus.on(GameEvents.PROGRESSIVE_WIN_SKIP, this._onProgressiveWinSkip, this);
        bus.on(GameEvents.PROGRESSIVE_WIN_END, this._onProgressiveWinEnd, this);

        bus.on(GameEvents.JACKPOT_TRIGGER, this._onJackpotTrigger, this);
        bus.on(GameEvents.JACKPOT_END, this._onFeatureOrJackpotEnd, this);
        bus.on(GameEvents.PICK_GAME_MATCH_FOUND, this._onPickGameMatchFound, this);

        bus.on(GameEvents.FEATURE_SELECT_OPEN,  this._onFeatureSelectOpen,  this);
        bus.on(GameEvents.FEATURE_SELECT_CLOSE,  this._onFeatureSelectClose, this);
        bus.on(GameEvents.FEATURE_SELECT_CHOICE, this._onFeatureChosen, this);
        bus.on(GameEvents.FREE_SPIN_START, this._onFeatureStart, this);
        bus.on(GameEvents.FREE_SPIN_GOLD_START, this._onFeatureStart, this);
        bus.on(GameEvents.TOPUP_START, this._onFeatureStart, this);
        bus.on(GameEvents.FREE_SPIN_END_POPUP, this._onFeatureEndPopup, this);
        bus.on(GameEvents.TOPUP_END_POPUP, this._onFeatureEndPopup, this);
        bus.on(GameEvents.FREE_SPIN_END_POPUP_CLOSED, this._onFeatureEndPopupClosed, this);
        bus.on(GameEvents.TOPUP_END_POPUP_CLOSED, this._onFeatureEndPopupClosed, this);

        bus.on(GameEvents.POT_WIN_INTRO,          this._onPotWinIntro,    this);
        bus.on(GameEvents.PICK_GAME_CLOSE,          this._onPickGameClose,  this);
        bus.on(GameEvents.TOPUP_TRANSITION_SHOW, this._onTransitionShow,  this);
        bus.on(GameEvents.TOPUP_TRANSITION_DONE,  this._onTransitionDone,  this);
        bus.on(GameEvents.WILD_TRAIL_ONE, this._onWildTrailOne, this);
        bus.on(GameEvents.WILD_TRAIL_ONE_HIT, this._onWildTrailHit, this);
        bus.on(GameEvents.RED_CREDIT_UPDATED, this._onRedCreditUpdated, this);
        bus.on(GameEvents.TOPUP_ABSORB_START, this._onTopUpAbsorbStart, this);
        bus.on(GameEvents.FREE_SPIN_GOLD_COIN_LAND, this._onGoldCoinLand, this);
    }

    private _loadMuteSettings(): void {
        try {
            const music = localStorage.getItem('setting_music_muted');
            const sfx = localStorage.getItem('setting_sfx_muted');
            const master = localStorage.getItem('setting_master_muted');
            const vol = localStorage.getItem('setting_volume');
            if (music !== null) this._bgmMuted = music === 'true';
            if (sfx !== null) this._sfxMuted = sfx === 'true';
            if (master !== null) this._masterMuted = master === 'true';
            if (vol !== null) {
                const parsed = parseFloat(vol);
                if (!Number.isNaN(parsed)) {
                    this.bgmVolume = Math.max(0, Math.min(1, parsed));
                    this.sfxVolume = this.bgmVolume;
                }
            }
        } catch (err) {
            Log.d('[SoundManager] localStorage not available', err);
        }
    }

    private _onGameReady(): void {
        this._startAmbience();
        if (GameData.instance.isResumingFreeSpin) {
            this._inFeatureMusic = true;
            if (this.bgmSource?.clip !== this.mxBonusLoop) {
                this._playMusic(this.mxBonusLoop, true);
            }
        }
    }

    private _onGameEntryEffect(): void {
        if (GameData.instance.isResumingFreeSpin || this._inFeatureMusic) return;
        if (this._introTriggered) return;
        this._introTriggered = true;
        this._playMusic(this.mxNormalIntro, false, () => this._playMusic(this.mxNormalLoop, true));
        const fallbackDelay = this._clipDurationSeconds(this.mxNormalIntro) || (this.introToLoopDelayMs / 1000);
        if (fallbackDelay > 0) {
            this.scheduleOnce(() => {
                if (this.bgmSource?.clip === this.mxNormalIntro) {
                    this._playMusic(this.mxNormalLoop, true);
                }
            }, fallbackDelay);
        }
        this._startAmbience();
    }

    private _onSpeedModeChanged(mode: SpeedMode): void {
        this._speedMode = mode;
    }

    private _onSpinStart(): void {
        Log.d(`[coinloop][SM._onSpinStart] stopCoinLoop()`);
        this._turboLandPlayed = false;
        this._stickyLandCount = 0;
        this._stickyWinSoundPlayedThisSpin = false;
        this.stopCoinLoop();
        const quick = this._speedMode === SpeedMode.QUICK || this._speedMode === SpeedMode.TURBO;
        this.playSFX(quick ? this.sxReelSpinQuickTurbo : this.sxReelSpin);
    }

    private _onReelStopped(payload: ReelStoppedPayload): void {
        const reelIndex = typeof payload === 'number' ? payload : payload?.reelIndex;
        if (reelIndex == null) return;

        if (this._speedMode === SpeedMode.TURBO) {
            if (!this._turboLandPlayed) {
                this._turboLandPlayed = true;
                this.playSFX(this.sxReelLandAll);
            }
            return;
        }

        if (this._speedMode === SpeedMode.NORMAL || this._speedMode === SpeedMode.QUICK) {
            this.playSFX(this._reelLandClip(reelIndex));
        }
    }

    private _onLongSpinTriggered(): void {
        this.playSFX(this.sxBonusTrigger);
    }

    private _onWinPresentStart(resp: SpinResponse): void {
        const lineCount = (resp?.matchedLinePays?.length ?? 0) + (resp?.waysPayWins?.length ?? 0);
        if (lineCount <= 0) return;
        this.playSymbolPayoutForLine(lineCount);
    }

    private _onProgressiveWinShow(): void {
        this._playMusic(this.mxProgressiveWin, false);
    }

    private _onProgressiveWinSkip(): void {
        this.stopProgressiveWinMusic();
    }

    stopProgressiveWinMusic(): void {
        if (!this.bgmSource || !this.mxProgressiveWinSkip) return;
        // Dừng ngay, không fade
        if (this._bgmFadeTick) { this.unschedule(this._bgmFadeTick); this._bgmFadeTick = null; }
        this.bgmSource.stop();
        this.bgmSource.clip = this.mxProgressiveWinSkip;
        this.bgmSource.loop = false;
        this.bgmSource.volume = this.bgmVolume;
        this.bgmSource.node.once(AudioSource.EventType.ENDED, () => this._restoreCurrentLoop(), this);
        if (!this._masterMuted && !this._bgmMuted) this.bgmSource.play();
    }

    private _onProgressiveWinEnd(): void {
        this._restoreCurrentLoop();
    }

    private _onJackpotTrigger(type: JackpotType): void {
        this.playSFX(this.sxBonusJpWin);
        const clip = this._jackpotMusic(type);
        if (clip) this._playMusic(clip, false);
    }

    private _onFeatureOrJackpotEnd(): void {
        this._restoreCurrentLoop();
    }

    private _onFeatureSelectOpen(): void {
        if (this._featureSelectSoundPlayed) return;
        this._featureSelectSoundPlayed = true;
        this.playSFX(this.sxSelectAFeature);
    }

    private _onFeatureSelectClose(): void {
        this._featureSelectSoundPlayed = false;
    }

    private _onFeatureChosen(): void {
        // sxFeatureSelect và BGM đã được play ngay khi nhấn nút trong FeatureSelectionPopup
    }

    private _onFeatureStart(): void {
        this._inFeatureMusic = true;
        this._startFeatureMusic();
    }

    private _onFeatureEndPopup(): void {
        Log.d(`[coinloop][SM._onFeatureEndPopup] coinLoopActive=${this._coinLoopActive}`);
        this._inFeatureMusic = false;
        this._playMusic(this.mxBonusCongratulation, false, () => this._playMusic(this.mxNormalLoop, true));
    }

    private _onFeatureEndPopupClosed(): void {
        Log.d(`[coinloop][SM._onFeatureEndPopupClosed] coinLoopActive=${this._coinLoopActive}`);
        this.stopCoinLoop();
        if (this.bgmSource?.clip === this.mxBonusCongratulation && this.bgmSource.playing) return;
        this._playMusic(this.mxNormalLoop, true);
    }

    private _onPickGameMatchFound(): void {
        this.playSFX(this.sxBonusFakeTrigger);
    }

    private _onPotWinIntro(): void {
        this.playSFX(this.sxBonusFakeTrigger);
        this._inFeatureMusic = true;
        this._startFeatureMusic();
    }

    private _onPickGameClose(): void {
        this._inFeatureMusic = false;
        this._restoreCurrentLoop();
    }

    private _onTransitionShow(): void {
        if (this._transitionSoundPlayed) return;
        this._transitionSoundPlayed = true;
        this.playSFX(this.sxTransition);
    }

    private _onTransitionDone(): void {
        this._transitionSoundPlayed = false;
    }

    private _onWildTrailOne(): void {
        this.playSFX(this.sxPotTrailWhoosh);
    }

    private _onWildTrailHit(): void {
        this.playSFX(this.sxPotHit);
    }

    private _onRedCreditUpdated(payload?: { totalRedCredit?: number; redCount?: number; reelIndex?: number }): void {
        const redCount = payload?.redCount ?? 0;
        const clips = [
            this.sxBonusStickyLand,
            this.sxBonusStickyLand2,
            this.sxBonusStickyLand3,
            this.sxBonusStickyLand4,
            this.sxBonusStickyLand5,
        ];
        const idx = Math.min(this._stickyLandCount, clips.length - 1);
        this.playSFX(clips[idx] ?? this.sxBonusStickyLand);
        this._stickyLandCount++;

        // Big red-coin win sound: play once per spin when normal-reel red coins exceed 6
        if (GameData.instance.currentMode === 'normal' && redCount > 6 && !this._stickyWinSoundPlayedThisSpin) {
            this._stickyWinSoundPlayedThisSpin = true;
            Log.d(`[coinloop][SM._onRedCreditUpdated] redCount=${redCount} > 6 → play sxBonusStickyWin`);
            this.playSFX(this.sxBonusStickyWin);
        }
    }

    private _onTopUpAbsorbStart(_payload?: { newCells?: StickyCellLike[]; plusOneSpinCount?: number }): void {
        // +1 spin sound is now handled by TopUpAbsorbEffect when the +1 symbol is actually shown on StickyOverlay.
        // Yellow/Green coin absorb sound is handled by StickyOverlayController when they appear on overlay.
    }

    private _onGoldCoinLand(_payload?: { cells?: StickyCellLike[] }): void {
        // sxBonusStickyGoldLand được play trực tiếp trong SymbolView._playLandBounce per-coin
    }

    private _startFeatureMusic(): void {
        if (this.bgmSource?.clip === this.mxBonusIdle || this.bgmSource?.clip === this.mxBonusLoop) return;
        this._playMusic(this.mxBonusIdle, false, () => this._playMusic(this.mxBonusLoop, true));
    }

    private _restoreCurrentLoop(): void {
        this._playMusic(this._inFeatureMusic ? this.mxBonusLoop : this.mxNormalLoop, true);
    }

    private _playMusic(clip: AudioClip | null, loop: boolean, onEnded?: () => void): void {
        if (!this.bgmSource || !clip) return;
        this._removeBonusLoopCallback();
        if (this.bgmCrossfadeSource?.playing) this.bgmCrossfadeSource.stop();
        const start = () => {
            if (!this.bgmSource || !clip) return;
            this.bgmSource.stop();
            this.bgmSource.clip = clip;
            this.bgmSource.loop = loop;
            this.bgmSource.volume = this.bgmVolume;
            if (onEnded) {
                this._bonusLoopCallback = onEnded;
                this.bgmSource.node.once(AudioSource.EventType.ENDED, onEnded, this);
            }
            if (!this._masterMuted && !this._bgmMuted) this.bgmSource.play();
        };
        this._fadeOutBgm(start);
    }

    private _fadeOutBgm(onDone?: () => void): void {
        if (this._bgmFadeTick) {
            this.unschedule(this._bgmFadeTick);
            this._bgmFadeTick = null;
        }
        if (!this.bgmSource || !this.bgmSource.playing || this.bgmFadeOutDurationMs <= 0) {
            if (this.bgmSource?.playing) this.bgmSource.stop();
            onDone?.();
            return;
        }
        const source = this.bgmSource;
        const startVolume = source.volume;
        const steps = 10;
        let step = 0;
        const interval = (this.bgmFadeOutDurationMs / 1000) / steps;
        const tick = () => {
            step++;
            source.volume = startVolume * Math.max(0, 1 - step / steps);
            if (step >= steps) {
                this.unschedule(tick);
                if (this._bgmFadeTick === tick) this._bgmFadeTick = null;
                source.stop();
                onDone?.();
            }
        };
        this._bgmFadeTick = tick;
        this.schedule(tick, interval);
    }

    private _removeBonusLoopCallback(): void {
        if (!this._bonusLoopCallback || !this.bgmSource) return;
        this.bgmSource.node.off(AudioSource.EventType.ENDED, this._bonusLoopCallback, this);
        this._bonusLoopCallback = null;
    }

    private _startAmbience(): void {
        if (!this.ambienceSource || !this.sxAmbience) return;
        if (this.ambienceSource.playing) return;
        this.ambienceSource.clip = this.sxAmbience;
        this.ambienceSource.loop = true;
        this.ambienceSource.volume = this.ambienceVolume;
        if (!this._masterMuted && !this._sfxMuted) this.ambienceSource.play();
    }

    private _reelLandClip(reelIndex: number): AudioClip | null {
        switch (reelIndex) {
            case 0: return this.sxReelLand1;
            case 1: return this.sxReelLand2;
            case 2: return this.sxReelLand3;
            case 3: return this.sxReelLand4;
            case 4: return this.sxReelLand5;
            default: return null;
        }
    }

    private _jackpotMusic(type: JackpotType): AudioClip | null {
        switch (type) {
            case JackpotType.GRAND: return this.mxGrandJackpotWin;
            case JackpotType.MAJOR: return this.mxMajorJackpotWin;
            case JackpotType.MINOR: return this.mxMinorJackpotWin;
            case JackpotType.MINI: return this.mxMiniJackpotWin;
            default: return null;
        }
    }

    private _clipDurationSeconds(clip: AudioClip | null): number {
        if (!clip) return 0;
        const timedClip = clip as AudioClip & { getDuration?: () => number; duration?: number };
        const duration = typeof timedClip.getDuration === 'function'
            ? timedClip.getDuration()
            : timedClip.duration;
        return typeof duration === 'number' && duration > 0 ? duration : 0;
    }

    playSFX(clip: AudioClip | null): void {
        if (!this.sfxSource || !clip || this._masterMuted || this._sfxMuted) return;
        this.sfxSource.playOneShot(clip, this.sfxVolume);
    }

    playBGM(clip: AudioClip | null): void {
        this._playMusic(clip, true);
    }

    playCoinLoop(): void {
        if (!this.sxCounterLoop) {
            Log.d(`[coinloop][SM.playCoinLoop] SKIP — sxCounterLoop=${!!this.sxCounterLoop}`);
            return;
        }
        if (!this.coinSource || !this.coinSource.isValid) {
            this._recreateCoinSource();
        }
        if (!this.coinSource) {
            Log.d(`[coinloop][SM.playCoinLoop] SKIP — failed to recreate coinSource`);
            return;
        }
        this._coinLoopActive = true;
        this.coinSource.volume = this.sfxVolume;
        if (this._masterMuted || this._sfxMuted) {
            Log.d(`[coinloop][SM.playCoinLoop] SKIP — muted (master=${this._masterMuted} sfx=${this._sfxMuted})`);
            return;
        }
        // Nếu đang phát clip khác hoặc loop chưa bật, restart để đảm bảo sx_counter_loop phát đúng
        const needRestart = this.coinSource.clip !== this.sxCounterLoop || !this.coinSource.loop;
        Log.d(`[coinloop][SM.playCoinLoop] valid=${this.coinSource.isValid} playing=${this.coinSource.playing} needRestart=${needRestart}`);
        if (needRestart) {
            this.coinSource.stop();
            this.coinSource.clip = this.sxCounterLoop;
            this.coinSource.loop = true;
        }
        if (!this.coinSource.playing) {
            Log.d(`[coinloop][SM.playCoinLoop] ▶ play()`);
            this.coinSource.play();
        } else {
            Log.d(`[coinloop][SM.playCoinLoop] already playing, skip play()`);
        }
    }

    stopCoinLoop(): void {
        Log.d(`[coinloop][SM.stopCoinLoop] coinLoopActive=${this._coinLoopActive} playing=${this.coinSource?.playing}`);
        this._coinLoopActive = false;
        if (!this.coinSource) return;

        // Cocos AudioSource on a persistent node ignores onDisable; stop()/clip=null
        // are async and may leave a stuck Web Audio player. Recreate the component
        // to guarantee the underlying player is destroyed.
        this.coinSource.volume = 0;
        this.coinSource.stop();
        this.coinSource.loop = false;
        this.coinSource.clip = null;
        this._recreateCoinSource();
    }

    private _recreateCoinSource(): void {
        if (!this.node) return;
        const oldSource = this.coinSource;
        this.coinSource = this.node.addComponent(AudioSource);
        Log.d(`[coinloop][SM._recreateCoinSource] oldValid=${oldSource?.isValid ?? false} newValid=${this.coinSource?.isValid ?? false}`);
        if (oldSource && oldSource.isValid) {
            oldSource.destroy();
        }
    }

    playCoinEnd(): void {
        Log.d(`[coinloop][SM.playCoinEnd] ► play sxCounterEnd`);
        this.playSFX(this.sxCounterEnd);
    }

    playCounterStart(): void {
        // Removed from the new asset list. Kept as a compatibility no-op.
    }

    playButtonClick(): void {
        this.playSFX(this.sxUiClick);
    }

    playBannerDisappear(): void {
        this.playSFX(this.sxBannerDisappear);
    }

    playBonusSelect(type: JackpotType): void {
        switch (type) {
            case JackpotType.MINI: this.playSFX(this.sxBonusSelectMini); break;
            case JackpotType.MINOR: this.playSFX(this.sxBonusSelectMinor); break;
            case JackpotType.MAJOR: this.playSFX(this.sxBonusSelectMajor); break;
            case JackpotType.GRAND: this.playSFX(this.sxBonusSelectGrand); break;
            default: break;
        }
    }

    playGirlSymbolAnim(): void {
        this.playSFX(this.sxGirlSymbolAnim);
    }

    playSymbolPayoutForLine(lineCount: number): void {
        this.playSFX(lineCount >= 5 ? this.sxSymbolMatchHighValue : this.sxSymbolMatchLowValue);
        this.playSFX(this.sxSymbolPayout);
    }

    playSymbolMatch7(): void {
        this.playGirlSymbolAnim();
    }

    playSymbolMatchBar(): void {
        // Removed from the new asset list. Kept as a compatibility no-op.
    }

    playSymbolMatchWild(): void {
        // Removed from the new asset list. Kept as a compatibility no-op.
    }

    playBuyBonusButton(): void {
        this.playButtonClick();
    }

    playNormalIntro(): void {
        this._onGameEntryEffect();
    }

    playBonusTrail(): void {
        this.playSFX(this.sxBonusTrail);
    }

    playPotTrailWhoosh(): void {
        this.playSFX(this.sxPotTrailWhoosh);
    }

    playFeatureSelectMusic(): void {
        this._inFeatureMusic = true;
        this._playMusic(this.mxBonusIdle, false, () => this._playMusic(this.mxBonusLoop, true));
    }

    initBGM(): void {
        this._startAmbience();
        if (GameData.instance.isResumingFreeSpin) {
            this._inFeatureMusic = true;
            if (this.bgmSource?.clip !== this.mxBonusLoop) {
                this._playMusic(this.mxBonusLoop, true);
            }
        }
    }

    getStatus(): object {
        return {
            hasInstance: !!SoundManager._instance,
            hasBgmSource: !!this.bgmSource,
            hasMxNormalLoop: !!this.mxNormalLoop,
            bgmMuted: this._bgmMuted,
            masterMuted: this._masterMuted,
            speedMode: this._speedMode,
            inFeatureMusic: this._inFeatureMusic,
        };
    }

    setMasterVolume(ratio: number): void {
        const v = Math.max(0, Math.min(1, ratio));
        this.bgmVolume = v;
        this.sfxVolume = v;
        if (this.bgmSource && !this._bgmMuted) this.bgmSource.volume = v;
        if (this.sfxSource) this.sfxSource.volume = v;
        if (this.coinSource) this.coinSource.volume = v;
        if (this.ambienceSource) this.ambienceSource.volume = v * this.ambienceVolume;
        try { localStorage.setItem('setting_volume', String(v)); } catch (_) {}
    }

    get masterVolume(): number { return this.bgmVolume; }

    setBGMMuted(muted: boolean): void {
        if (this._bgmMuted === muted) return;
        this._bgmMuted = muted;
        if (!this.bgmSource) return;
        if (muted) {
            this.bgmSource.pause();
            this.bgmCrossfadeSource?.pause();
        } else if (!this._masterMuted) {
            if (this.bgmSource.clip) this.bgmSource.play();
            else this._restoreCurrentLoop();
        }
    }

    setSFXMuted(muted: boolean): void {
        if (this._sfxMuted === muted) return;
        this._sfxMuted = muted;
        if (muted) {
            Log.d(`[coinloop][SM.setSFXMuted] muted=true → stopCoinLoop()`);
            this.stopCoinLoop();
            this.ambienceSource?.stop();
        } else if (!this._masterMuted) {
            if (this._coinLoopActive) this.playCoinLoop();
            this._startAmbience();
        }
    }

    toggleBGM(): void { this.setBGMMuted(!this._bgmMuted); }
    toggleSFX(): void { this.setSFXMuted(!this._sfxMuted); }

    setMasterMuted(muted: boolean): void {
        if (this._masterMuted === muted) return;
        this._masterMuted = muted;
        if (muted) {
            this.bgmSource?.pause();
            this.bgmCrossfadeSource?.pause();
            this.sfxSource?.pause();
            this.coinSource?.pause();
            this.ambienceSource?.pause();
        } else {
            if (this.bgmSource?.clip && !this._bgmMuted) this.bgmSource.play();
            if (!this._sfxMuted) {
                if (this._coinLoopActive) this.playCoinLoop();
                this._startAmbience();
            }
        }
    }
}
