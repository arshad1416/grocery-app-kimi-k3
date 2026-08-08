/**
 * Barcode-lookup consent gate.
 *
 * Naming a scanned product requires sending the barcode number — and nothing
 * else — to the Open Food Facts public database (world.openfoodfacts.org).
 * That network call must not happen before the user has agreed to it, so both
 * scanner entry points (Home scan tab, Add-Item sheet) call
 * ensureBarcodeLookupConsent() before opening the camera.
 *
 * Mirrors the flyer-scan pricing opt-in pattern in GroceryListScreen: keep the
 * feature discoverable, present the disclosure inline on first use, and
 * persist the choice in settings (`barcodeScanningEnabled`, default false).
 * lookupProduct() re-checks the setting as defence-in-depth, so no future
 * caller can reach the network without it.
 */

import { Alert } from 'react-native';
import { getSettings, setBarcodeScanningEnabled } from '../config/settings';

export async function ensureBarcodeLookupConsent(): Promise<boolean> {
  if (getSettings().barcodeScanningEnabled ?? false) return true;

  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Turn on barcode lookups?',
      'To name scanned products, PantryRun sends the barcode number — and nothing else — to the Open Food Facts public food database. No account, device ID, or list data is sent with it. You can turn this off anytime in Settings.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Turn on & scan',
          onPress: async () => {
            try {
              await setBarcodeScanningEnabled(true);
              resolve(true);
            } catch {
              resolve(false);
            }
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
