// Clear demo mode flags from localStorage
console.log('Checking localStorage for demo mode flags...');

// Check current state
const twitchDemo = localStorage.getItem('demoModeEnabled');
const youtubeDemo = localStorage.getItem('youtube_demo_mode');

console.log('Current state:');
console.log('Twitch demo mode:', twitchDemo);
console.log('YouTube demo mode:', youtubeDemo);

// Clear both demo modes
localStorage.removeItem('demoModeEnabled');
localStorage.removeItem('youtube_demo_mode');

console.log('Demo modes cleared!');

// Verify cleared
const twitchDemoAfter = localStorage.getItem('demoModeEnabled');
const youtubeDemoAfter = localStorage.getItem('youtube_demo_mode');

console.log('After clearing:');
console.log('Twitch demo mode:', twitchDemoAfter);
console.log('YouTube demo mode:', youtubeDemoAfter);
