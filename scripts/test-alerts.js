import { AlertService } from './src/services/alertsService';

// Test alert system
const alertService = AlertService.getInstance();
alertService.initialize();

// Simulate different types of alerts
setTimeout(() => {
  console.log('Testing Twitch subscription alert...');
  window.postMessage({
    platform: 'twitch',
    alert_type: 'sub',
    user_name: 'TestUser123',
    message: 'TestUser123 just subscribed!',
  }, '*');
}, 2000);

setTimeout(() => {
  console.log('Testing Twitch gift alert...');
  window.postMessage({
    platform: 'twitch',
    alert_type: 'gift',
    user_name: 'GiftGiver',
    message: 'GiftGiver gifted 5 subscriptions!',
    count: 5,
  }, '*');
}, 4000);

setTimeout(() => {
  console.log('Testing YouTube live alert...');
  window.postMessage({
    platform: 'youtube',
    alert_type: 'live',
    user_name: 'ChannelName',
    message: 'A new stream or video is live!',
  }, '*');
}, 6000);