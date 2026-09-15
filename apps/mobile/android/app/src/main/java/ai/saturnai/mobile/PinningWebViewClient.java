package ai.saturnai.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Bundle;
import android.util.Log;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import org.json.JSONObject;

/**
 * Enforces the SPEC.md §8 LAN pairing contract's cert pin: a self-signed
 * host cert is accepted only when its SHA-256 fingerprint matches the one
 * the QR code carried at pairing time (stored by
 * {@code src/lib/tokenStore.ts} under the "CapacitorStorage" prefs group
 * that {@code @capacitor/preferences} uses on Android).
 *
 * Everything else delegates to Capacitor's own {@link BridgeWebViewClient}
 * unchanged — this class only narrows the one case Android's default
 * WebViewClient already rejects (an untrusted cert), from "always cancel"
 * to "proceed if and only if it's the pinned host cert."
 */
public class PinningWebViewClient extends BridgeWebViewClient {

  private static final String TAG = "SaturnPinning";
  private static final String PREFS_GROUP = "CapacitorStorage";
  private static final String SESSION_KEY = "saturn.remote.session";

  private final Context appContext;

  public PinningWebViewClient(Bridge bridge) {
    super(bridge);
    this.appContext = bridge.getContext().getApplicationContext();
  }

  @Override
  public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
    String expected = readPinnedFingerprint();
    if (expected == null) {
      // No pairing on file yet (or it predates a fingerprint, i.e. a
      // tunnel-mode pairing) — fall back to the platform default, which is
      // to reject. There is nothing to pin against.
      handler.cancel();
      return;
    }

    String observed = sha256Fingerprint(error.getCertificate());
    if (observed != null && fingerprintsMatch(expected, observed)) {
      handler.proceed();
    } else {
      Log.w(TAG, "rejecting a host cert that does not match the pinned pairing fingerprint");
      handler.cancel();
    }
  }

  private String readPinnedFingerprint() {
    try {
      SharedPreferences prefs = appContext.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
      String raw = prefs.getString(SESSION_KEY, null);
      if (raw == null) return null;
      String fingerprint = new JSONObject(raw).optString("fingerprint", null);
      return (fingerprint == null || fingerprint.isEmpty()) ? null : fingerprint;
    } catch (Exception e) {
      Log.w(TAG, "could not read the pinned fingerprint", e);
      return null;
    }
  }

  /** android.net.http.SslCertificate has no public accessor for the raw X509Certificate; this is the documented workaround. */
  private String sha256Fingerprint(SslCertificate sslCertificate) {
    try {
      Bundle bundle = SslCertificate.saveState(sslCertificate);
      byte[] bytes = bundle.getByteArray("x509-certificate");
      if (bytes == null) return null;
      X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(
        new ByteArrayInputStream(bytes)
      );
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());
      StringBuilder hex = new StringBuilder(digest.length * 2);
      for (byte b : digest) {
        hex.append(String.format("%02x", b));
      }
      return hex.toString();
    } catch (Exception e) {
      Log.w(TAG, "could not compute the presented cert's fingerprint", e);
      return null;
    }
  }

  private boolean fingerprintsMatch(String expected, String observed) {
    String a = expected.replaceAll("[^0-9a-fA-F]", "").toLowerCase();
    String b = observed.replaceAll("[^0-9a-fA-F]", "").toLowerCase();
    if (a.length() != 64 || b.length() != 64) return false;
    int diff = 0;
    for (int i = 0; i < a.length(); i++) {
      diff |= a.charAt(i) ^ b.charAt(i);
    }
    return diff == 0;
  }
}
