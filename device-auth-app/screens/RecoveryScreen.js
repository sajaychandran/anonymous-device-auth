import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Clipboard
} from 'react-native';
import { callFunction } from '../firebaseConfig';

export default function RecoveryScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRecovery = async () => {
    if (!username || !recoveryCode || !newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const recoverPassword = callFunction('recoverPassword');
      const payload = { username: username.trim(), recovery_code: recoveryCode.trim(), new_password: newPassword };
      const result = await recoverPassword(payload);
      Alert.alert(
        'Password Reset! 🎉',
        `Password reset successfully!\n\n⚠️ NEW RECOVERY CODE:\n${result.data.new_recovery_code}\n\nSave this new code!`,
        [
          { text: 'Copy Code', onPress: () => { Clipboard.setString(result.data.new_recovery_code); Alert.alert('Copied!', 'New recovery code copied to clipboard'); navigation.reset({ index: 0, routes: [{ name: 'Login' }] }); } },
          { text: 'Go to Login', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }) }
        ],
        { cancelable: false }
      );
    } catch (error) {
      let errorMessage = 'Recovery failed. Please try again.';
      if (error.message.includes('Invalid')) errorMessage = 'Invalid username or recovery code';
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
          <Text style={styles.title}>🔑 Recover Password</Text>
          <Text style={styles.subtitle}>Enter your recovery code to reset password</Text>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Username</Text>
            <TextInput style={styles.input} placeholder="Enter your username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} editable={!loading} returnKeyType="next" />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Recovery Code</Text>
            <TextInput style={styles.input} placeholder="XXXX-XXXX-XXXX" value={recoveryCode} onChangeText={setRecoveryCode} autoCapitalize="characters" autoCorrect={false} editable={!loading} returnKeyType="next" />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>New Password</Text>
            <TextInput style={styles.input} placeholder="Enter new password (min 8 characters)" value={newPassword} onChangeText={setNewPassword} secureTextEntry editable={!loading} returnKeyType="next" />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Confirm New Password</Text>
            <TextInput style={styles.input} placeholder="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry editable={!loading} returnKeyType="done" onSubmitEditing={handleRecovery} />
          </View>
          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleRecovery} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Reset Password</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Login')} disabled={loading}>
            <Text style={styles.linkText}>Back to <Text style={styles.linkTextBold}>Login</Text></Text>
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
  button: { backgroundColor: '#FF9500', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  buttonDisabled: { backgroundColor: '#ccc' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  linkText: { textAlign: 'center', marginTop: 20, fontSize: 16, color: '#666' },
  linkTextBold: { color: '#007AFF', fontWeight: '600' }
});
