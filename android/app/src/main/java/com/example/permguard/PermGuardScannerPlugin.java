package com.example.permguard;

import android.app.AppOpsManager;
import android.app.usage.NetworkStats;
import android.app.usage.NetworkStatsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@CapacitorPlugin(name = "PermGuardScanner")
public class PermGuardScannerPlugin extends Plugin {

    private static final Set<String> SENSITIVE_PERMISSIONS = new HashSet<>(Arrays.asList(
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.READ_CONTACTS"
    ));

    @PluginMethod
    public void isNativeDevice(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isNative", true);
        ret.put("osVersion", Build.VERSION.RELEASE);
        ret.put("deviceModel", Build.MANUFACTURER + " " + Build.MODEL);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkUsageAccess(PluginCall call) {
        Context context = getContext();
        AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        int mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.getPackageName()
        );
        boolean granted = (mode == AppOpsManager.MODE_ALLOWED);

        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void openUsageSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void scanRealInstalledApps(PluginCall call) {
        Context context = getContext();
        PackageManager pm = context.getPackageManager();

        // 1. Check Usage Access status
        AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        int mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.getPackageName()
        );
        boolean usageGranted = (mode == AppOpsManager.MODE_ALLOWED);

        // 2. Query 7-day foreground usage stats if permitted
        Map<String, Long> foregroundMinutesMap = new HashMap<>();
        Map<String, Long> lastUsedTimeMap = new HashMap<>();

        if (usageGranted) {
            try {
                UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
                Calendar cal = Calendar.getInstance();
                long endTime = cal.getTimeInMillis();
                cal.add(Calendar.DAY_OF_YEAR, -7);
                long startTime = cal.getTimeInMillis();

                List<UsageStats> statsList = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startTime, endTime);
                if (statsList != null) {
                    for (UsageStats stats : statsList) {
                        String pkg = stats.getPackageName();
                        long existingTime = foregroundMinutesMap.containsKey(pkg) ? foregroundMinutesMap.get(pkg) : 0;
                        foregroundMinutesMap.put(pkg, existingTime + (stats.getTotalTimeInForeground() / (1000 * 60)));

                        long lastUsed = stats.getLastTimeUsed();
                        if (!lastUsedTimeMap.containsKey(pkg) || lastUsed > lastUsedTimeMap.get(pkg)) {
                            lastUsedTimeMap.put(pkg, lastUsed);
                        }
                    }
                }
            } catch (Exception e) {
                // UsageStats collection failed gracefully
            }
        }

        // 3. Query all installed packages on the actual phone
        List<PackageInfo> installedPackages;
        try {
            installedPackages = pm.getInstalledPackages(PackageManager.GET_PERMISSIONS);
        } catch (Exception e) {
            call.reject("Failed to query package manager: " + e.getMessage());
            return;
        }

        JSArray appsArray = new JSArray();
        SimpleDateFormat dateFormat = new SimpleDateFormat("MMM d, HH:mm", Locale.US);

        for (PackageInfo pi : installedPackages) {
            if (pi.requestedPermissions == null) continue;

            // Extract granted/requested sensitive permissions
            JSArray grantedArray = new JSArray();
            for (String perm : pi.requestedPermissions) {
                if (SENSITIVE_PERMISSIONS.contains(perm)) {
                    String shortName = perm.replace("android.permission.", "");
                    grantedArray.put(shortName);
                }
            }

            // Only audit apps that request sensitive permissions
            if (grantedArray.length() > 0) {
                JSObject appObj = new JSObject();
                String appName = pi.applicationInfo != null
                    ? pm.getApplicationLabel(pi.applicationInfo).toString()
                    : pi.packageName;

                boolean isSystem = (pi.applicationInfo != null &&
                    (pi.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0);

                long foregroundMinutes = foregroundMinutesMap.containsKey(pi.packageName)
                    ? foregroundMinutesMap.get(pi.packageName)
                    : 0;

                String lastUsedStr = "Unknown";
                if (lastUsedTimeMap.containsKey(pi.packageName) && lastUsedTimeMap.get(pi.packageName) > 0) {
                    lastUsedStr = dateFormat.format(new Date(lastUsedTimeMap.get(pi.packageName)));
                } else if (!usageGranted) {
                    lastUsedStr = "Usage access required";
                }

                // 4. Query 7-day Network Data Usage
                JSObject dataObj = new JSObject();
                dataObj.put("available", usageGranted);
                if (usageGranted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    try {
                        NetworkStatsManager nsm = (NetworkStatsManager) context.getSystemService(Context.NETWORK_STATS_SERVICE);
                        Calendar cal = Calendar.getInstance();
                        long end = cal.getTimeInMillis();
                        cal.add(Calendar.DAY_OF_YEAR, -7);
                        long start = cal.getTimeInMillis();

                        int uid = pi.applicationInfo.uid;
                        NetworkStats mobileStats = nsm.queryDetailsForUid(ConnectivityManager.TYPE_MOBILE, null, start, end, uid);
                        NetworkStats wifiStats = nsm.queryDetailsForUid(ConnectivityManager.TYPE_WIFI, null, start, end, uid);

                        long mobileBytes = 0;
                        long wifiBytes = 0;

                        NetworkStats.Bucket bucket = new NetworkStats.Bucket();
                        while (mobileStats.hasNextBucket()) {
                            mobileStats.getNextBucket(bucket);
                            mobileBytes += (bucket.getRxBytes() + bucket.getTxBytes());
                        }
                        while (wifiStats.hasNextBucket()) {
                            wifiStats.getNextBucket(bucket);
                            wifiBytes += (bucket.getRxBytes() + bucket.getTxBytes());
                        }
                        mobileStats.close();
                        wifiStats.close();

                        dataObj.put("mobileBytes", mobileBytes);
                        dataObj.put("wifiBytes", wifiBytes);
                    } catch (Exception ex) {
                        dataObj.put("mobileBytes", null);
                        dataObj.put("wifiBytes", null);
                    }
                } else {
                    dataObj.put("mobileBytes", null);
                    dataObj.put("wifiBytes", null);
                }

                appObj.put("appName", appName);
                appObj.put("packageName", pi.packageName);
                appObj.put("permissions", grantedArray);
                appObj.put("foregroundMinutes", foregroundMinutes);
                appObj.put("isSystemApp", isSystem);
                appObj.put("lastUsedTime", lastUsedStr);
                appObj.put("dataUsage", dataObj);

                appsArray.put(appObj);
            }
        }

        JSObject result = new JSObject();
        result.put("apps", appsArray);
        result.put("usageAccessGranted", usageGranted);
        result.put("totalAudited", appsArray.length());
        result.put("totalInstalled", installedPackages.size());

        call.resolve(result);
    }
}
