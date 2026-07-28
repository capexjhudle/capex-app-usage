/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { headlessTask } from './src/background/BackgroundTask';
import BackgroundFetch from 'react-native-background-fetch';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerComponent(appName, () => App);
BackgroundFetch.registerHeadlessTask(headlessTask);
