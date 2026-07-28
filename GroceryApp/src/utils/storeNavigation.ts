import { Linking, Platform } from 'react-native';
import { getSettings } from '../config/settings';

export async function navigateToStore(storeName: string): Promise<void> {
  const settings = getSettings();
  const fsa = settings.flippFsa ?? 'L0R';
  const query = encodeURIComponent(`${storeName} ${fsa}`);
  const pref = settings.navigationApp;

  let url: string;
  if (pref === 'google' || (pref !== 'apple' && Platform.OS === 'android')) {
    url = `https://www.google.com/maps/search/?api=1&query=${query}`;
  } else {
    const googleUrl = `comgooglemaps://?q=${query}`;
    const canOpen = await Linking.canOpenURL(googleUrl);
    url = canOpen ? googleUrl : `https://maps.apple.com/?q=${query}`;
  }

  try {
    await Linking.openURL(url);
  } catch {
    await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  }
}
