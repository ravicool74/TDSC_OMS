import { Stack } from 'expo-router';

export default function CustomerRootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="tenders" />
      <Stack.Screen name="services" />
      <Stack.Screen name="request-new" />
      <Stack.Screen name="requests" />
    </Stack>
  );
}
