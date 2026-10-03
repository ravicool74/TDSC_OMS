# TDSC Office Management System
## Application Installation, Distribution & Update Guide

This document outlines how installation, distribution, and updates work across the **Android Native APK**, **Web Application (PWA)**, and **Cloud Backend**.

---

## 1. Quick Access Links

| Platform / Service | Access Link | Description |
| :--- | :--- | :--- |
| **Android APK (Direct Download)** | [https://tdscoms.onrender.com/download-apk](https://tdscoms.onrender.com/download-apk) | Direct 1-click APK download (36 MB). Sideloadable on any Android phone or BlueStacks emulator. |
| **Web Application & PWA** | [https://frontend-rho-woad-43.vercel.app](https://frontend-rho-woad-43.vercel.app) | Live responsive web app. Can be installed directly to home screen on iOS & Android. |
| **Backend API Health Check** | [https://tdscoms.onrender.com/api/health](https://tdscoms.onrender.com/api/health) | Live FastAPI backend status. |
| **App Version & Update API** | [https://tdscoms.onrender.com/api/app/version](https://tdscoms.onrender.com/api/app/version) | Public update check endpoint used by the app. |

---

## 2. First-Time Installation for Users

### Method A: Native Android APK (Phone or BlueStacks)
1. On the device or emulator, open Chrome and visit:
   **`https://tdscoms.onrender.com/download-apk`**
2. The download will start automatically (`TDSC-Office-Manager.apk`).
3. When the download completes, tap the file in your notifications or Downloads folder.
4. If prompted, enable **"Allow from this source"** in Android Settings.
5. Tap **Install**.
6. Open the app and log in with your credentials.

> **BlueStacks Tip**: You can also simply drag-and-drop `TDSC-Office-Manager.apk` directly from your PC into the BlueStacks emulator window, or press `Ctrl + Shift + B` to select the file.

---

### Method B: Progressive Web App (PWA) / "Add to Home Screen"
> **Zero installation maintenance. Updates 100% automatically forever.**

1. On your phone (Android or iPhone), open Chrome or Safari and go to:
   **`https://frontend-rho-woad-43.vercel.app`**
2. On Android Chrome: Tap the top-right three dots $\rightarrow$ **"Install App"** (or **"Add to Home screen"**).
3. On iOS Safari: Tap the Share button at the bottom $\rightarrow$ **"Add to Home Screen"**.
4. The TDSC app icon will appear on your phone's home screen and run in full-screen standalone mode.

---

## 3. How Updates Work (The Complete Workflow)

The application has three tiers of updates depending on what part of the system is changed:

### Tier 1: Backend, Database & PDF Voucher Logic
*Examples: Bug fixes in Python calculations, database schema updates, changing GST invoice formats, adding new server endpoints.*

- **Action required by user**: **NONE (Zero Effort).**
- **Action required by developer**: Just push your code changes to GitHub `main`.
- **How it updates**: Render automatically pulls `main`, installs any new dependencies, and restarts the backend within 2-3 minutes.
- **Result**: All existing installed APKs and web users immediately receive the new backend logic on their next API request without updating or downloading anything.

---

### Tier 2: Web App & PWA Updates
*Examples: Changes to screens, UI buttons, forms, or navigation on the web interface.*

- **Action required by user**: **NONE.**
- **Action required by developer**: Deploy via Vercel CLI (`npx vercel --prod`).
- **How it updates**: Vercel deploys in ~30 seconds.
- **Result**: The next time a user opens or refreshes the web app or PWA, the newest code is loaded automatically.

---

### Tier 3: Android Mobile App UI Updates (In-App 1-Click Updater)
*Examples: Adding a brand-new screen to the Android app, altering mobile layout.*

The app features a built-in **In-App Auto-Update Checker**:

```
+-----------------------------------------------------------+
| 1. User opens app (or taps "Check for Updates" in More)   |
+-----------------------------------------------------------+
                             |
                             v
+-----------------------------------------------------------+
| App queries: GET https://tdscoms.onrender.com/api/app/version |
+-----------------------------------------------------------+
                             |
        +--------------------+--------------------+
        |                                         |
[remote.version_code > local]           [remote.version_code <= local]
        |                                         |
        v                                         v
+------------------------------------+  +-------------------+
| Popup: "Update Available! (v1.1.0)"|  | Silent on launch  |
| - What's new release notes         |  | (or "Up to Date!" |
| - [Download & Update Now] button   |  | if tapped manual) |
+------------------------------------+  +-------------------+
        |
        v (User taps "Update Now")
+-----------------------------------------------------------+
| Android browser / download manager downloads the new APK  |
+-----------------------------------------------------------+
                             |
                             v
+-----------------------------------------------------------+
| Android prompts: "Do you want to update this app? [Update]"|
| User taps Update -> Seamless upgrade, user data preserved!|
+-----------------------------------------------------------+
```

---

## 4. Step-by-Step Developer Release Guide (Rolling Out an Update)

When you make changes to the mobile app and want to publish an update to all users:

### Step 1: Bump the Version Numbers
1. In `frontend/android/app/build.gradle`:
   ```groovy
   versionCode 3         // Increment by 1
   versionName "1.2.0"   // New version label
   ```
2. In `frontend/app.json`:
   ```json
   "version": "1.2.0"
   ```

### Step 2: Update the Version Endpoint in Backend
In `backend/server.py` around line 150, update `get_app_version()`:
```python
@app.get("/api/app/version")
@api_router.get("/app/version")
async def get_app_version():
    return {
        "version": "1.2.0",
        "version_code": 3,
        "apk_url": "https://tdscoms.onrender.com/download-apk",
        "release_notes": "• List the new features or fixes here\n• Another improvement item",
        "mandatory": False,  # Set to True if older versions must be blocked
    }
```

### Step 3: Recompile the Release APK
Double-click `build-apk.bat` (or run in terminal):
```powershell
.\build-apk.bat
```
This generates the updated `TDSC-Office-Manager.apk` at the project root with the matching cryptographic signature.

### Step 4: Commit and Push to GitHub
```bash
git add .
git commit -m "chore(release): bump version to 1.2.0 (versionCode 3)"
git push origin main
```
- Render will automatically build the new commit and host the new `TDSC-Office-Manager.apk`.
- Deploy the updated frontend to Vercel:
  ```bash
  cd frontend
  npx vercel --prod --yes
  ```

### Step 5: What Happens Next
**Done!** Every user who opens the app will automatically see the **"Update Available!"** dialog and can install the update in 1 tap.

---

## 5. Security & Signing Credentials
- **Keystore Location**: `frontend/android/app/debug.keystore`
- **Key Alias**: `androiddebugkey`
- **Certificate SHA-256 Digest**: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`
- **Application ID**: `com.emergent.hrtenderhub.mla9i8`

> **IMPORTANT**: As long as the `debug.keystore` and `applicationId` remain unchanged, Android recognizes every new build as an authentic update to the existing app and preserves all logged-in user sessions.
