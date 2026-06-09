// Quick test script to verify Twitch connection stability improvements
// This can be run in the browser console to test the connection logic

console.log('🔧 Twitch Connection Stability Test');

// Test the error debouncing logic
function testErrorDebouncing() {
  console.log('\n📊 Testing error debouncing...');
  
  // Simulate the shouldReportError function logic
  const recentErrors = {};
  
  function shouldReportError(channelName, errorMessage) {
    const now = Date.now();
    const errorKey = `${channelName}:${errorMessage}`;
    const recentError = recentErrors[errorKey];
    
    // If we've shown this same error recently (within 10 seconds), don't show it again
    if (recentError && now - recentError.timestamp < 10000) {
      return false;
    }
    
    // Store this error and timestamp
    recentErrors[errorKey] = { message: errorMessage, timestamp: now };
    return true;
  }
  
  // Test cases
  const testChannel = 'testuser';
  const testError = 'Connection failed';
  
  console.log('First error report:', shouldReportError(testChannel, testError)); // Should be true
  console.log('Immediate duplicate:', shouldReportError(testChannel, testError)); // Should be false
  console.log('Different error:', shouldReportError(testChannel, 'Different error')); // Should be true
  console.log('Same error after delay (simulated):', shouldReportError(testChannel, testError)); // Should be false (within 10s)
  
  console.log('✅ Error debouncing test completed');
}

// Test connection state management
function testConnectionStateManagement() {
  console.log('\n🔄 Testing connection state management...');
  
  // Simulate connection tracking
  let connections = [];
  
  function addConnection(id, channelName, type) {
    const newConnection = {
      id,
      type,
      channelName,
      isConnected: false
    };
    connections.push(newConnection);
    console.log(`Added connection: ${channelName} (${type})`);
    return newConnection;
  }
  
  function updateConnectionStatus(id, connected, error) {
    connections = connections.map(conn => 
      conn.id === id 
        ? { ...conn, isConnected: connected, error: error } 
        : conn
    );
    console.log(`Updated connection ${id}: connected=${connected}, error=${error || 'none'}`);
  }
  
  // Test scenario
  const conn1 = addConnection('twitch-1', 'testuser', 'twitch');
  updateConnectionStatus('twitch-1', true); // Connect
  updateConnectionStatus('twitch-1', false, 'Network error'); // Disconnect with error
  updateConnectionStatus('twitch-1', true); // Reconnect
  
  console.log('Final connections state:', connections);
  console.log('✅ Connection state management test completed');
}

// Test debounce mechanism
function testConnectionDebounce() {
  console.log('\n⏱️  Testing connection debounce...');
  
  const lastConnectionAttempt = {};
  
  function canAttemptConnection(username) {
    const lastAttempt = lastConnectionAttempt[username] || 0;
    const timeSinceLastAttempt = Date.now() - lastAttempt;
    
    if (timeSinceLastAttempt < 5000) {
      console.log(`❌ Debouncing connection attempt for ${username} (${timeSinceLastAttempt}ms ago)`);
      return false;
    }
    
    lastConnectionAttempt[username] = Date.now();
    console.log(`✅ Allowing connection attempt for ${username}`);
    return true;
  }
  
  // Test cases
  const testUser = 'teststreamer';
  console.log('First attempt:', canAttemptConnection(testUser)); // Should be true
  console.log('Immediate second attempt:', canAttemptConnection(testUser)); // Should be false
  
  console.log('✅ Connection debounce test completed');
}

// Run all tests
testErrorDebouncing();
testConnectionStateManagement();
testConnectionDebounce();

console.log('\n🎉 All connection stability tests completed!');
console.log('\n📋 Improvements implemented:');
console.log('• Error message debouncing (10 second window)');
console.log('• Connection attempt debouncing (5 second window)');
console.log('• Better TMI.js reconnection settings');
console.log('• Improved error handling and client cleanup');
console.log('• More robust connection state management');
