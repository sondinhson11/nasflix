# SFLIX — TV / Leanback Mode

Bộ file bổ sung để chạy web SFLIX trên **Android TV / Google TV / Fire TV / box Android** dùng điều khiển từ xa.

## Cách hoạt động

- **Tự phát hiện TV** qua UA (`Android TV`, `GoogleTV`, `SmartTV`, `AFT…`, `Chromecast`, `Leanback`, `WebOS`, `Tizen`) **hoặc** bật thủ công bằng `?tv=1` trên URL.
- Khi bật:
  - Body có class `tv-mode` → CSS `assets/css/tv.css` chuyển sang **10-foot UI** (font to, card to, spacing rộng).
  - `assets/js/tv.js` lắng nghe phím **D-pad** (←/→/↑/↓), **OK/Enter**, **Back**, **media play/pause** → focus phần tử gần nhất theo hướng.
  - **Hover effects bị tắt** (TV không có chuột).
  - **Focus rings cyan sáng** quanh phần tử đang focus.
  - **Hint bar** gợi ý phím điều khiển tự ẩn sau vài giây.
  - **Phím `/`** mở nhanh ô tìm kiếm.
  - **↑/↓ khi gõ trong ô search** hoạt động như alphabet picker (TV không có soft-keyboard).

## Bật / tắt thủ công

Mở trang bất kỳ và thêm `?tv=1` lên URL, ví dụ:

```
http://sondinhson.cloud/index.html?tv=1
http://sondinhson.cloud/catalog.html?type=series&tv=1
http://sondinhson.cloud/detail.html?movieKey=...&tv=1
http://sondinhson.cloud/player.html?...&tv=1
```

Lần đầu bật, `localStorage` sẽ ghi nhớ `SFLIX_tv_mode=1` → các lần sau không cần query string.

Để tắt, mở DevTools console và gõ:

```js
localStorage.removeItem("SFLIX_tv_mode"); location.reload();
```

## Phím tắt trên điều khiển

| Phím | Hành động |
| --- | --- |
| ← / → / ↑ / ↓ | Di chuyển focus theo không gian (cùng hàng/cột) |
| OK / Enter | Mở / chọn — với `<select>` (bộ lọc) sẽ mở popup danh sách |
| Back | Đóng overlay / popup / sheet → quay lại trang trước |
| `/` | Mở ô tìm kiếm |
| Media Play / Pause | Điều khiển player (forward cho iframe) |
| ↑ / ↓ trong popup select | Di chuyển giữa các lựa chọn |
| OK trong popup select | Áp dụng lựa chọn |
| Back trong popup select | Hủy, đóng popup không đổi |

## Đóng gói APK cho Android TV

Nếu bạn đang build APK bằng **WebView Gold / Capacitor / TWA / Android Studio bằng tay**, thêm các thành phần sau để app hiện đúng trong khu vực "Apps for TV" và nhận phím D-pad chuẩn:

### 1. `AndroidManifest.xml`

```xml
<uses-feature
  android:name="android.software.leanback"
  android:required="false" />

<application
  android:allowBackup="true"
  android:banner="@drawable/tv_banner"
  android:icon="@mipmap/ic_launcher"
  android:label="@string/app_name"
  android:theme="@style/AppTheme">

  <activity
    android:name=".MainActivity"
    android:exported="true"
    android:screenOrientation="landscape"
    android:configChanges="orientation|screenSize|keyboardHidden|uiMode"
    android:launchMode="singleTask">

    <!-- Bắt buộc cho Android TV: launcher intent trong LEANBACK_LAUNCHER category -->
    <intent-filter>
      <action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" />
      <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
    </intent-filter>
  </activity>
</application>
```

`android:required="false"` cho phép app vẫn cài được trên điện thoại/máy tính bảng (vẫn hoạt động trên TV nhờ CSS `?tv=1`).

### 2. Banner cho TV (320×180 px, PNG/JPEG)

Đặt vào `res/drawable/tv_banner.png`. Đây là hình hiển thị trên Android TV launcher — thường là logo + tagline.

### 3. Theme cho TV

`res/values/styles.xml`:

```xml
<style name="AppTheme" parent="Theme.Leanback" />
```

Hoặc nếu app chạy được cả mobile + TV (khuyến nghị):

```xml
<style name="AppTheme" parent="Theme.AppCompat.NoActionBar">
  <item name="android:windowBackground">@color/black</item>
  <item name="android:colorPrimary">#00d4ff</item>
</style>
```

`res/values-television/styles.xml`:

```xml
<style name="AppTheme" parent="Theme.Leanback" />
```

### 4. Cho phép dùng hardware media keys

Nếu dùng WebView gốc, mặc định phím **MediaPlay / MediaPause** đã được WebView xử lý (focus vào iframe player). Không cần thêm code Java.

### 5. Bật hardware acceleration

```xml
<application
  android:hardwareAccelerated="true"
  ... >
```

## Test thủ công trên máy tính

Không cần TV thật — bật DevTools, chuyển sang **Device toolbar**, chọn preset **"Android TV 1080p"** rồi mở `index.html?tv=1`. Dùng phím **←/→/↑/↓/Enter/Escape** trên bàn phím để mô phỏng D-pad.
