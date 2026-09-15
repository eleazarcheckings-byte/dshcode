package ai.saturnai.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Wires the SPEC.md §8 LAN pairing contract's certificate pin onto the
 * bridge's own WebView. The device stores the pinned fingerprint (the QR
 * payload's `fingerprint` field) in Preferences under
 * {@link PinnedCertPreferences#KEY}, the same store {@code src/lib/tokenStore.ts}
 * writes to during pairing, so this stays in sync with no extra plumbing.
 *
 * Android's own WebViewClient only calls {@code onReceivedSslError} for a
 * cert the platform doesn't already trust — exactly the self-signed LAN
 * case this app needs to accept, but only for the one host it was paired
 * to. See {@link PinningWebViewClient} for the actual check.
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    this.bridge.getWebView().setWebViewClient(new PinningWebViewClient(this.bridge));
  }
}
