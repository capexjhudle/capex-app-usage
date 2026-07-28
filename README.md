# React Native App Usage Data Collector

## Overview

This project is a **React Native Android application** that collects **per-application network usage statistics** from the user's device and stores them locally. The collected data is **not sent immediately**. Instead, it is queued locally and transmitted to the backend **only when triggered** (via Push Notification, Manual Sync, or another event).

The goal is to minimize unnecessary network requests while ensuring that historical usage data is preserved even if the device is offline.

---

# System Architecture

```
                ┌─────────────────────────────┐
                │ Android NetworkStatsManager │
                └──────────────┬──────────────┘
                               │
                      Hourly Background Job
                     (WorkManager / BackgroundFetch)
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Local SQLite Queue  │
                    │  - payload          │
                    │  - collected_at     │
                    │  - sent             │
                    └─────────┬───────────┘
                              │
                   Trigger (FCM / Manual Sync)
                              │
                              ▼
                      REST API Batch Upload
                              │
                              ▼
                   Mark Records as Successfully Sent
```

---

# Objectives

* Collect application network usage every hour.
* Continue collecting even if there is no internet connection.
* Store collected data locally.
* Send data only when requested.
* Prevent duplicate uploads.
* Support background execution.

---

# Technologies

## React Native

Main application framework.

---

## Android Native Module (Kotlin)

Responsible for accessing Android's `NetworkStatsManager` API.

This module will:

* Read application network usage.
* Return:

  * Package Name
  * UID
  * Received Bytes (RX)
  * Transmitted Bytes (TX)

---

## NetworkStatsManager

Android API used to retrieve network traffic statistics per application.

Reference:

```
android.app.usage.NetworkStatsManager
```

---

## WorkManager

Responsible for scheduling periodic background collection.

Recommended interval:

* Every 1 hour

Responsibilities:

* Execute background task
* Call native module
* Save collected data to SQLite

---

## SQLite

Acts as the local queue.

Example table:

```sql
usage_queue

id
payload
collected_at
sent
```

Where:

* `payload` = JSON data
* `collected_at` = Timestamp
* `sent` = 0 or 1

---

## REST API

Receives batched usage data.

Example:

```
POST /api/device/usage
```

Example payload:

```json
{
  "entries": [
    {
      "packageName": "com.facebook.katana",
      "rxBytes": 120000,
      "txBytes": 80000,
      "timestamp": 1785123000
    }
  ]
}
```

---

# Data Collection Flow

```
Every Hour

        │
        ▼

Run Background Task

        │
        ▼

Read NetworkStatsManager

        │
        ▼

Convert to JSON

        │
        ▼

Insert into SQLite Queue

        │
        ▼

Wait for Send Trigger
```

---

# Sending Flow

```
Trigger Received

        │
        ▼

Read unsent rows

        │
        ▼

Create batch payload

        │
        ▼

POST to REST API

        │
        ▼

Success?

   YES              NO

Mark sent      Keep in queue
```

---

# Why Queue First?

Instead of sending every hour:

```
Collect
↓

Immediately Send
↓

Network Failure

↓

Data Lost
```

We instead:

```
Collect

↓

Store

↓

Retry Later

↓

No Data Loss
```

---

# Background Execution

JavaScript timers are **not reliable** while the app is:

* In the background
* Swiped away
* Killed by Android

Therefore, background collection should use native scheduling.

Recommended options:

* WorkManager (Preferred)
* react-native-background-fetch (uses native scheduling internally)

---

# Permissions

## Usage Access Permission

Required:

```
android.permission.PACKAGE_USAGE_STATS
```

This is **not** a normal runtime permission.

The application must redirect the user to:

```
Settings > Usage Access
```

where the user manually grants permission.

---

## Internet

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

---

## Receive Boot Completed

(Optional)

Allows background jobs to resume after device restart.

```xml
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
```

---

# Suggested Project Structure

```
src/
│
├── database/
│     sqlite.ts
│
├── services/
│     UsageCollector.ts
│     SyncService.ts
│
├── native/
│     NetworkUsageModule.ts
│
├── background/
│     BackgroundTask.ts
│
├── notifications/
│     FirebaseHandler.ts
│
└── api/
      usageApi.ts
```

Android:

```
android/

├── NetworkUsageModule.kt
├── UsageWorker.kt
└── MainApplication.kt
```

---

# Future Enhancements

* Wi-Fi and Mobile usage separation
* Device information
* Battery level during collection
* Charging status
* Foreground application detection
* Daily aggregated reports
* Retry strategy with exponential backoff
* Data compression before upload
* Upload only on Wi-Fi (optional)
* Encryption of locally stored usage data

---

# Advantages of This Architecture

* Reliable background collection
* Works while offline
* Prevents data loss
* Efficient batch uploads
* Reduces API calls
* Easy to retry failed uploads
* Scalable for additional telemetry data

---

# Development Roadmap

## Phase 1

* Create React Native project
* Integrate SQLite
* Create Android Native Module
* Read NetworkStatsManager

---

## Phase 2

* Implement WorkManager
* Collect data every hour
* Save snapshots to SQLite

---

## Phase 3

* Build REST API integration
* Batch upload queued data
* Mark uploaded records as sent

---

## Phase 4

* Integrate Firebase Cloud Messaging
* Trigger uploads through data-only push notifications
* Add retry and failure handling

---

# Notes

* This implementation targets **Android only**, as `NetworkStatsManager` is not available on iOS.
* Background task execution intervals are managed by Android and may not run at the exact requested time due to battery optimization policies (Doze Mode, App Standby, OEM restrictions).
* User consent and transparency are important. Inform users why Usage Access permission is required and how the collected data will be used.
