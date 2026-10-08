export function respostaTrajeto() {
  const inicio = Date.parse('2026-10-08T11:00:00Z');
  return {
    itineraries: [
      {
        startTime: inicio,
        endTime: inicio + 30 * 60_000,
        duration: 1800,
        legs: [
          {
            mode: 'WALK',
            startTime: inicio,
            endTime: inicio + 5 * 60_000,
            distance: 350,
            from: { name: 'Origin', lat: -5.7945, lon: -35.211 },
            to: { name: 'Parada A', lat: -5.8, lon: -35.211 },
            legGeometry: { points: 'xvjb@nc|uEp@Z' },
          },
          {
            mode: 'BUS',
            startTime: inicio + 10 * 60_000,
            endTime: inicio + 30 * 60_000,
            distance: 5000,
            from: { name: 'Parada A', lat: -5.8, lon: -35.211 },
            to: { name: 'Parada B', lat: -5.835, lon: -35.207 },
            route: { shortName: '33', longName: 'Planalto / Praia do Meio' },
            trip: { tripHeadsign: 'Praia do Meio' },
          },
        ],
      },
    ],
  };
}
