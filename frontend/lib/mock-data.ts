export function generateMockData(sensor: string) {
  const data = [];
  const baseTime = new Date();
  baseTime.setHours(0, 0, 0, 0);

  for (let i = 0; i < 30; i++) {
    const time = new Date(baseTime.getTime() + i * (24 * 60 * 60 * 1000 / 30));
    const realConsumption = Math.floor(Math.random() * 100 + 50); // 50-150
    const optimizedConsumption = Math.floor(realConsumption * (0.7 + Math.random() * 0.2)); // 10-30% lower

    data.push({
      time: time.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      real: realConsumption,
      optimized: optimizedConsumption,
    });
  }

  return data;
}

export function generateMockAttacks() {
  const attacks = [];
  const sensorIds = ['W1', 'W2', 'W3', 'W4'];
  const attackTypes = ['DDoS', 'Injection SQL', 'Brute Force', 'Malware', 'Phishing', 'Accès Non Autorisé'];
  
  // Generate 40+ attacks spread throughout the day
  const attackCount = Math.floor(Math.random() * 15) + 35; // 35-50 attacks

  for (let i = 0; i < attackCount; i++) {
    const timeOffset = Math.floor(Math.random() * 86400000); // Random time in last 24 hours
    const attackTime = new Date(Date.now() - timeOffset);

    attacks.push({
      id: `attack-${i}-${Math.random().toString(36).substr(2, 9)}`,
      sensorId: sensorIds[Math.floor(Math.random() * sensorIds.length)],
      timestamp: attackTime.toLocaleString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
      type: attackTypes[Math.floor(Math.random() * attackTypes.length)],
      score: Math.floor(Math.random() * 60 + 40), // 40-100
      status: Math.random() > 0.3 ? 'Bloquée' : 'Détectée',
    });
  }

  // Sort by most recent first
  return attacks.sort((a, b) => {
    const aTime = new Date(a.timestamp);
    const bTime = new Date(b.timestamp);
    return bTime.getTime() - aTime.getTime();
  });
}
