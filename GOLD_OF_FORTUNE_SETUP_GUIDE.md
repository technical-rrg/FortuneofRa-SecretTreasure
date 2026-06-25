# Gold of Fortune — Setup Guide

> Hướng dẫn chuyển project **Shangri-La of Fortune** (3×3) → **Gold of Fortune** (3×5, Ways Pay).
> Toàn bộ phần code đã rewrite in-place. Tài liệu này hướng dẫn bạn:
> 1. Bỏ file ảnh nào, đặt tên gì.
> 2. Sửa Scene / Prefab thế nào (kéo Reel 4, Reel 5, gán SpriteFrame).
> 3. Bật / Tắt API thật.
> 4. Test mỗi feature ở môi trường `USE_REAL_API = false`.

---

## 1. Symbol Set — File ảnh cần chuẩn bị

> Để trong: `assets/bundle/textures/symbol/` (cùng thư mục với Symbol.plist hiện tại).
> Cách dễ nhất: thêm các frame mới vào `Symbol.plist` với đúng tên dưới đây (auto-atlas).
> Hoặc đặt từng file PNG riêng nếu không dùng atlas.

### 1.1 — Reel symbols (xuất hiện trên reel khi spin)

| Tên frame / file | SymbolId | Mô tả | Kích thước gợi ý |
|---|---|---|---|
| `minor_q` | `SymbolId.MINOR_Q` (0) | Chữ Q (Minor symbol) | 150×150 |
| `minor_k` | `SymbolId.MINOR_K` (1) | Chữ K | 150×150 |
| `minor_a` | `SymbolId.MINOR_A` (2) | Chữ A | 150×150 |
| `major_coin` | `SymbolId.MAJOR_COIN` (3) | Đồng tiền vàng | 150×150 |
| `major_ingot` | `SymbolId.MAJOR_INGOT` (4) | Thỏi vàng (元寶) | 150×150 |
| `major_ship` | `SymbolId.MAJOR_SHIP` (5) | Thuyền vàng | 150×150 |
| `major_turtle` | `SymbolId.MAJOR_TURTLE` (6) | Rùa vàng | 150×150 |
| `major_phoenix` | `SymbolId.MAJOR_PHOENIX` (7) | Phượng hoàng | 150×150 |
| `wild_trail` | `SymbolId.WILD` (8) | Wild Trail (chỉ reel 2/3/4) — Bat + Peach | 150×150 |
| `sticky_red` | `SymbolId.STICKY_RED` (9) | Sticky Red (Normal Spin) — nền đỏ + số credit | 150×150 |
| `sticky_yellow` | `SymbolId.STICKY_YELLOW` (10) | Sticky Yellow (Re-Spin / Free Spin) | 150×150 |
| `sticky_green` | `SymbolId.STICKY_GREEN` (11) | Sticky Green (Re-Spin) | 150×150 |
| `plus_one_spin` | `SymbolId.PLUS_ONE_SPIN` (12) | +1 Re-Spin Symbol | 150×150 |

### 1.2 — Jackpot symbols (chỉ dùng trong Pick Game 3×4)

| Tên frame / file | SymbolId | Mô tả |
|---|---|---|
| `jp_idle` | `SymbolId.JP_IDLE` (13) | Coin úp mặt (chưa lật) |
| `jp_mini` | `SymbolId.JP_MINI` (14) | Coin tier Mini |
| `jp_minor` | `SymbolId.JP_MINOR` (15) | Coin tier Minor |
| `jp_major` | `SymbolId.JP_MAJOR` (16) | Coin tier Major |
| `jp_grand` | `SymbolId.JP_GRAND` (17) | Coin tier Grand |

### 1.3 — Blur frames (khi reel quay)

Một file blur tương ứng cho từng symbol ở trên, đặt cùng atlas, tên kèm hậu tố `_blur`:

```
minor_q_blur, minor_k_blur, minor_a_blur,
major_coin_blur, major_ingot_blur, major_ship_blur, major_turtle_blur, major_phoenix_blur,
wild_trail_blur, sticky_red_blur, sticky_yellow_blur, sticky_green_blur, plus_one_spin_blur
```

(Jackpot symbols không cần blur vì không xuất hiện trên reel quay.)

### 1.4 — UI ảnh khác (sẽ làm ở turn sau, liệt kê trước để bạn chuẩn bị)

| Hạng mục | Tên file | Mô tả |
|---|---|---|
| Pot Trail | `pot_bat`, `pot_peach`, `pot_trail_line` | Animation Bat + Peach + vệt sáng |
| Pot Level | `pot_level_0..3.png` | 4 trạng thái Pot (default/10/30/50) |
| Pick Game | `pick_coin_back`, `pick_coin_flip_anim/*` | Coin mặt sau + animation lật |
| Feature Select | `fs_select_bg`, `fs_select_topup_btn`, `fs_select_free_btn` | Popup chọn feature |
| Long Spin VFX | `long_spin_vfx_frame_0..N.png` | Đã có sẵn từ project cũ — đổi sprite frame |
| Re-Spin UI | `respin_bg`, `respin_counter` | Background + spin counter |
| Free Spin UI | `freespin_bg_gof`, `freespin_counter` | Background mới |
| Buy Feature | `buy_topup_btn`, `buy_freespin_btn` | 2 nút mua |

---

## 2. Cách gắn SpriteFrame vào SymbolView

`SymbolView` component có 2 array:

```ts
@property([SpriteFrame]) symbolFrames: SpriteFrame[] = [];  // index = SymbolId
@property([SpriteFrame]) blurFrames:   SpriteFrame[] = [];
```

> ★ **Quan trọng**: Index phải khớp **đúng** giá trị enum `SymbolId`. Vì có symbol Jackpot ở index 13–17, mảng phải có **18 phần tử** (0–17).

### Cách kéo trong Editor:

1. Trong Scene, mở prefab Reel (hoặc Symbol Node).
2. Chọn node có `SymbolView` component.
3. Vào Inspector, expand `symbolFrames`, set Size = `18`.
4. Kéo từng SpriteFrame theo đúng index (xem bảng mục 1.1 + 1.2).
5. Tương tự với `blurFrames` size = 13 (chỉ 0–12, jackpot không cần).

> Nếu ô nào chưa có asset, để `null` — sẽ hiện ô trống lúc test, không crash.

---

## 3. Scene Setup — Chuyển từ 3 reel → 5 reel

### 3.1 — Mở scene chính (game scene, không phải loading.scene)

Project hiện chỉ có `assets/loading.scene` được index. Scene game chính có thể nằm trong các bundle, hoặc bạn sẽ tạo mới. Chỉ rõ tôi để tôi giúp setup.

Cấu trúc mong muốn:

```
Canvas
└── SlotMachineRoot
    ├── ReelMask (Mask, kích thước 5 cột × 3 hàng)
    │   ├── Reel_0 (ReelController)
    │   ├── Reel_1 (ReelController)
    │   ├── Reel_2 (ReelController)  ← THÊM MỚI
    │   ├── Reel_3 (ReelController)  ← THÊM MỚI
    │   └── Reel_4 (ReelController)  ← cũ là Reel_2, đổi index
    ├── PaylineDisplay (sẽ thay bằng WaysPayDisplay ở turn sau)
    ├── LongSpinVFX_Reel0  (chỉ active khi 3+ Red trên reel 0)
    ├── LongSpinVFX_Reel1
    ├── LongSpinVFX_Reel2
    ├── LongSpinVFX_Reel3
    └── PotTrailLayer (sẽ làm ở turn D)
```

### 3.2 — Mỗi Reel có 7 Node con (giữ nguyên layout cũ)

```
Reel_X
├── ExtraTop2  (buffer, ngoài Mask)
├── ExtraTop1  (buffer, ngoài Mask)
├── Top        (visible row 0)
├── Mid        (visible row 1)
├── Bot        (visible row 2)
├── ExtraBot1  (buffer, ngoài Mask)
└── ExtraBot2  (buffer, ngoài Mask)
```

> Cấu trúc này đã có sẵn từ slot 3×3 — chỉ cần **clone Reel 2 hai lần** để tạo Reel_3 và Reel_4, sau đó dịch X-position cách đều.

### 3.3 — Inspector `SlotMachineController`

Trong scene, chọn `SlotMachineRoot` node có component `SlotMachineController`:

| Field | Giá trị mới |
|---|---|
| `reels[]` | Kéo cả 5 ReelController vào (Reel_0..Reel_4) |
| `initialCenterIndices` | `[0, 1, 2, 3, 4]` (5 phần tử) |
| `longSpinVFXNode` | (deprecated) — sẽ chuyển sang array ở turn D |
| `vfxFrames[]` | giữ nguyên |
| `normalModeSettings`, `quickModeSettings`, `turboModeSettings` | giữ nguyên |

> ★ Code đã được cập nhật để **tự động** detect số lượng reel từ `reels.length`. Không cần sửa code nếu Inspector array đúng.

---

## 4. Symbol weights & Mock spin

File `assets/scripts/data/GameData.ts` đã có sẵn 5 reel strips mặc định (`DEFAULT_REEL_STRIPS`). Mỗi strip dài 30 ô, trộn ngẫu nhiên Minor / Major / Wild / Sticky.

Để force scenario test (vd: Grand Jackpot, Feature Trigger), dùng `ForcedMockAdapter` y như project cũ:

```ts
// Trong GameManager.onLoad() hoặc nơi khởi tạo
import { ForcedMockAdapter, TestScenario } from '../data/MockDataProvider';
NetworkManager.instance.setAdapter(new ForcedMockAdapter(TestScenario.FEATURE_TRIGGER_RESPIN));
```

Các scenario có sẵn (sẽ làm full ở các turn sau):

- `NO_WIN` — không thắng
- `NORMAL_WIN` — 3 Phoenix in a row
- `BIG_WIN` — 5 Phoenix in a row (243 ways nhiều combo)
- `LONG_SPIN_TRIGGER` — 3 Red sticky trên reel 0..3 → kích Long Spin
- `FEATURE_TRIGGER_RESPIN` — 6 Red sticky → vào Feature Select
- `FEATURE_TRIGGER_FREESPIN` — 6 Red sticky + nhiều hơn ở reel 2/3/4
- `POT_WIN` — Wild Trail xuất hiện liên tục → trigger Pot Win
- `GRAND_JACKPOT` — Pick game match 3 Grand

---

## 5. API real vs mock

File `assets/scripts/data/ServerConfig.ts` có flag:

```ts
export const USE_REAL_API = false;   // ← để false để dùng mock
```

Khi `false`:
- `NetworkManager` dùng `MockAdapter` (random) hoặc `ForcedMockAdapter` (scenario)
- Toàn bộ login/enter/spin/claim đều giả lập, không gọi HTTP
- Tất cả feature mới (Pot/Pick/Feature Select/Re-Spin/Free Spin/Buy) đều có mock builder riêng

Khi có API thật (sau này), chỉ cần:
1. Đặt `USE_REAL_API = true`
2. Server schema mới (nếu có thay đổi) sẽ được thêm vào `NetworkManager._convertSpinResponse()` qua field mới (Pot/Sticky/PickGame). Code đã viết để chấp nhận thiếu field — fallback về mock.

---

## 6. Trạng thái triển khai

| Bước | Status | File chính |
|---|---|---|
| B1. SlotTypes 3×5 + symbol set mới | ✅ Turn này | `data/SlotTypes.ts` |
| B2. GameData (5 strips, ways config, sticky state) | ✅ Turn này | `data/GameData.ts` |
| B3. MockDataProvider (Gold of Fortune logic) | ✅ Turn này | `data/MockDataProvider.ts` |
| B4. WaysPayCalculator (243 ways engine) | ✅ Turn này | `data/WaysPayCalculator.ts` |
| B5. SymbolManager (new sprite map) | ✅ Turn này | `manager/SymbolManager.ts` |
| B6. SlotMachineController 5-reel | ⏳ Turn sau | `controller/SlotMachineController.ts` |
| B7. WaysPayDisplay (thay PaylineDisplay) | ⏳ Turn sau | `controller/WaysPayDisplay.ts` (new) |
| C. Long Spin (3 Red reel 0..3) | ⏳ Turn sau | |
| D. Wild Trail + Pot Level + Pot Win | ⏳ Turn sau | |
| E. Pick Game 3×4 | ⏳ Turn sau | |
| F. Feature Selection (6 Red) | ⏳ Turn sau | |
| G. Re-Spin / Top Up | ⏳ Turn sau | |
| H. Free Spin (8 spin, yellow wild) | ⏳ Turn sau | |
| I. Buy Feature (Re-Spin + Free Spin) | ⏳ Turn sau | |

---

## 7. Lưu ý compile / migration

Sau khi rewrite SlotTypes.ts, **một số file legacy** sẽ có code DEAD-CODE (không bao giờ chạy với data mới) nhưng vẫn compile:

- `manager/GameManager.ts` — `_detectJackpot()` dùng `SymbolId.WILD_3X / RED_LIGHTNING / BLUE_LIGHTNING` để check 3-of-a-kind ⇒ với strip mới sẽ không bao giờ match (vì 3 ID này đã đổi giá trị thành alias, không xuất hiện trên strip). Sẽ được xóa ở turn D/E khi làm Pot/Pick.
- `manager/SoundManager.ts` — `has3x / hasWild` checks tương tự, dead code.
- `manager/NetworkManager.ts` — PS mapping cho `OneSeven/DoubleBar/...` — chỉ dùng khi `USE_REAL_API = true` với schema cũ. Sẽ được update khi có schema server mới.
- `controller/PaylineDisplay.ts` + `PaylineIndicatorManager.ts` — sẽ bị xóa ở turn B7.

Toàn bộ legacy alias đã được giữ ở giá trị enum 90–98 để compile xanh:

```ts
// Old (deprecated, không xuất hiện trên reel strip mới)
SEVEN_SINGLE   = 90,
SEVEN_DOUBLE   = 91,
SEVEN_TRIPLE   = 92,
BAR_SINGLE     = 93,
BAR_DOUBLE     = 94,
WILD_3X        = 95,
BONUS          = 96,
RED_LIGHTNING  = 97,
BLUE_LIGHTNING = 98,
```

Đừng dùng chúng trong code mới — luôn dùng `SymbolId.MINOR_Q`, `SymbolId.MAJOR_PHOENIX`, `SymbolId.STICKY_RED`, v.v.
