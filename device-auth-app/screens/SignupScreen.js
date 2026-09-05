import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Clipboard
} from 'react-native';
import { callFunction } from '../firebaseConfig';
import { createDeviceHash } from '../deviceFingerprint';

export default function SignupScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    if (!username || !password || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const deviceInfo = await createDeviceHash();
      const signupFunction = callFunction('signup');
      const payload = {
        username: username.trim(),
        password: password, // plaintext over HTTPS — Argon2-hashed server-side
        client_hash: deviceInfo.hash,
        platform: deviceInfo.platform
      };
      const result = await signupFunction(payload);
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      Alert.alert(
        'Success! 🎉',
        `Account created!\nUser ID: ${result.data.user_id}\n\n⚠️ IMPORTANT - RECOVERY CODE:\n${result.data.recovery_code}\n\nSave this code! You'll need it to recover your password.`,
        [
          { text: 'Copy Code', onPress: () => { Clipboard.setString(result.data.recovery_code); Alert.alert('Copied!', 'Recovery code copied to clipboard'); navigation.reset({ index: 0, routes: [{ name: 'Login' }] }); } },
          { text: 'Go to Login', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }) }
        ],
        { cancelable: false }
      );
    } catch (error) {
      let errorMessage = 'Signup failed. Please try again.';
      if (error.message.includes('already registered')) errorMessage = 'This device is already registered. One account per device allowed.';
      else if (error.message.includes('already taken')) errorMessage = 'Username is already taken. Please choose another.';
      else if (error.message) errorMessage = error.message;
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>One account per device</Text>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Username</Text>
            <TextInput style={styles.input} placeholder="Enter username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} editable={!loading} returnKeyType="next" />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <TextInput style={styles.input} placeholder="Enter password (min 8 characters)" value={password} onChangeText={setPassword} secureTextEntry editable={!loading} returnKeyType="next" />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Confirm Password</Text>
            <TextInput style={styles.input} placeholder="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry editable={!loading} returnKeyType="done" onSubmitEditing={handleSignup} />
          </View>
          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSignup} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign Up</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
            <Text style={styles.linkText}>Already have an account? <Text style={styles.linkTextBold}>Login</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scrollContainer: { flexGrow: 1, justifyContent: 'center' },
  content: { padding: 20 },
  title: { fontSize: 32, fontWeight: 'bold', marginBottom: 8, textAlign: 'center', color: '#333' },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 40 },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 16, fontWeight: '600', marginBottom: 8, color: '#333' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 15, fontSize: 16 },
  button: { backgroundColor: '#007AFF', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonDisabled: { backgroundColor: '#ccc' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  linkText: { textAlign: 'center', marginTop: 20, fontSize: 16, color: '#666' },
  linkTextBold: { color: '#007AFF', fontWeight: '600' }
});
