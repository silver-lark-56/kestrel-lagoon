// KESTREL LAGOON — game data: the city, its people, its jobs, its rules.
// Every name, character, vehicle, song and place here is original fiction
// written for this game. Nothing is borrowed from any commercial game.
export const WORLD = {
  halfX: 460, halfZ: 360, roadGap: 76, roadWidth: 14,
  waterLevel: -0.6, dayLengthSec: 480, // one full game day = 8 real minutes
};

export const DISTRICTS = [
  { id: 'causeway', name: 'PELICAN CAUSEWAY', x0: 300, z0: -90, x1: 460, z1: 90, heat: 2, blurb: 'The long bridge out to the flats.' },
  { id: 'stilt', name: 'STILT ROW', x0: -460, z0: -90, x1: -300, z1: 90, heat: 1, blurb: 'Houses on poles over the shallows.' },
  { id: 'quay', name: 'NEON QUAY', x0: -150, z0: -360, x1: 150, z1: -190, heat: 3, blurb: 'Bars, clubs and bad decisions.', labelDx: 45 },
  { id: 'cannery', name: 'OLD CANNERY', x0: -460, z0: -360, x1: -300, z1: -190, heat: 2, blurb: 'Rusted fish works, quiet streets.' },
  { id: 'marina', name: 'GULL MARINA', x0: 150, z0: 190, x1: 460, z1: 360, heat: 1, blurb: 'Yachts, gulls and slow money.', labelDx: -50, labelDz: -30 },
  { id: 'flats', name: 'HANGAR FLATS', x0: 300, z0: 190, x1: 460, z1: 360, heat: 0, blurb: 'Airstrip and empty hangars.', labelDx: 25, labelDz: 35 },
  { id: 'gardens', name: 'CORAL GARDENS', x0: -150, z0: 190, x1: 150, z1: 360, heat: 1, blurb: 'Palm streets and pastel walls.' },
  { id: 'watch', name: 'HARBOR WATCH', x0: -150, z0: -90, x1: 150, z1: 190, heat: 2, blurb: 'Downtown towers over the water.' },
  { id: 'lantern', name: 'LANTERN DISTRICT', x0: 150, z0: -190, x1: 300, z1: 190, heat: 3, blurb: 'Night market, all night.' },
  { id: 'point', name: 'GULL POINT', x0: -300, z0: 90, x1: -150, z1: 190, heat: 0, blurb: 'The quiet end of the lagoon.' },
];

export const PROTAGONIST = {
  name: 'Rook Calloway', role: 'Wheelman, back from three years away',
  logline: 'Three years gone for a job that went sideways. Rook is back in Kestrel Lagoon — and the Dredgers own the water now.',
};

export const CREW = [
  { id: 'mara', name: 'Mara Voss', callsign: 'WRENCH', role: 'Driver', color: '#ff5d8f', skin: '#c98d5f', hair: '#2b2b33', hairStyle: 'bun',
    ability: 'GETAWAY', abilityDesc: 'Brings a getaway car to your marker', order: 'FOLLOW' },
  { id: 'ivo', name: 'Ivo Kade', callsign: 'GHOSTLINE', role: 'Hacker', color: '#4de3ff', skin: '#e8b98d', hair: '#101014', hairStyle: 'mohawk',
    ability: 'BLACKOUT', abilityDesc: 'Kills the heli spotlight, drops 1 star', order: 'FOLLOW' },
  { id: 'sana', name: 'Sana Reyes', callsign: 'FARSHOT', role: 'Lookout', color: '#ffd166', skin: '#8a5a3b', hair: '#3a2415', hairStyle: 'braids',
    ability: 'MARK', abilityDesc: 'Marks every enemy on the minimap', order: 'FOLLOW' },
];

export const CONTACTS = [
  { id: 'delia', name: 'Delia Marsh', role: 'Fixer · “The Heron”', color: '#b388ff', skin: '#e8b98d', hair: '#d8d8e0', hairStyle: 'bob' },
  { id: 'nadia', name: 'Nadia Fenn', role: 'Market boss · Lantern District', color: '#ff8a5c', skin: '#8a5a3b', hair: '#1c1c22', hairStyle: 'braids' },
  { id: 'ans', name: 'Anselm Pryce', role: 'Harbor boss', color: '#7ddf8e', skin: '#c98d5f', hair: '#6b4a2b', hairStyle: 'flat' },
  { id: 'venn', name: 'Dario Venn', role: 'Boss of the Dredgers', color: '#ff6b4a', skin: '#e8b98d', hair: '#1c1c22', hairStyle: 'slick' },
  { id: 'okafor', name: 'Chief Okafor', role: 'Kestrel Lagoon PD', color: '#8fb7ff', skin: '#5a3a26', hair: '#111114', hairStyle: 'short' },
];

export const CREW_ORDERS = ['FOLLOW', 'HOLD', 'ATTACK', 'DISTRACT'];

// One job = a chain of stages. Stage types: goto, drive, steal, kill,
// escape, talk, deliver. Every stage names its map position and its line.
export const JOBS = [
  { id: 'j1', no: 1, title: 'SHALLOW WATER', contact: 'delia', payout: 1500, blurb: 'Delia needs a driver who knows the lagoon roads.',
    stages: [
      { type: 'goto', label: 'Meet Delia at the Boathouse', x: -210, z: 150, line: 'Rook. Three years, and you still owe me a boat ride.', speaker: 'delia' },
      { type: 'drive', label: 'Drive Delia to Gull Marina', x: 380, z: 280, line: 'The Dredgers took my routes while you were gone. We take them back.', speaker: 'delia' },
      { type: 'talk', label: 'Hear Delia out', x: 380, z: 280, line: 'First rule of the lagoon: never pay for a car you can borrow.', speaker: 'delia' },
    ] },
  { id: 'j2', no: 2, title: 'SALT RUN', contact: 'ans', payout: 3200, blurb: 'A truck of “salt” that must not stop at any checkpoint.',
    stages: [
      { type: 'steal', label: 'Steal the Gannet van on Harbor Watch', x: 60, z: 60, line: 'Borrow it clean. No alarms, no witnesses, no drama.', speaker: 'ans' },
      { type: 'drive', label: 'Haul the van to Old Cannery', x: -380, z: -280, line: 'KLPD runs the causeway tonight. Take the back streets.', speaker: 'ans' },
      { type: 'escape', label: 'Lose the heat, then park in the yard', x: -380, z: -280, line: 'Clean run. The lagoon pays its drivers, Rook.', speaker: 'ans' },
    ] },
  { id: 'j3', no: 3, title: 'NIGHT MARKET', contact: 'nadia', payout: 4200, blurb: 'The Dredgers collect protection in the Lantern District. End it.',
    stages: [
      { type: 'goto', label: 'Reach the Lantern District market', x: 220, z: 0, line: 'They shake down my vendors every Friday. Not this Friday.', speaker: 'nadia' },
      { type: 'kill', label: 'Take out the Dredger crew', count: 6, x: 220, z: 0, line: 'Venn sends boys to do a boss’s job. Send them home.', speaker: 'nadia' },
      { type: 'escape', label: 'Lose any heat', x: 220, z: 0, line: 'The market breathes again. That is worth more than cash.', speaker: 'nadia' },
    ] },
  { id: 'j4', no: 4, title: 'SIREN SONG', contact: 'okafor', payout: 5000, blurb: 'The chief wants a rat inside the Dredgers — and a favor first.',
    stages: [
      { type: 'goto', label: 'Meet the chief at Harbor Watch', x: 0, z: 140, line: 'I do not like you, Calloway. I dislike Venn more.', speaker: 'okafor' },
      { type: 'drive', label: 'Shadow the Dredger courier — do not spook him', x: -220, z: -260, line: 'Stay two cars back. He leads us to the stash house.', speaker: 'okafor' },
      { type: 'kill', label: 'Clear the stash house guards', count: 4, x: -220, z: -260, line: 'Take the ledger. Leave the building standing. Mostly.', speaker: 'okafor' },
      { type: 'deliver', label: 'Bring the ledger to the chief', x: 0, z: 140, line: 'This buys you one clean slate. Spend it wisely.', speaker: 'okafor' },
    ] },
  { id: 'j5', no: 5, title: 'GLASS TIDE', contact: 'mara', payout: 6500, blurb: 'Mara’s old race crew wants their champion back — one race decides it.',
    stages: [
      { type: 'goto', label: 'Meet Mara at Hangar Flats', x: 380, z: 280, line: 'One race, winner takes the strip. You drive. I navigate.', speaker: 'mara' },
      { type: 'drive', label: 'Win the airstrip drag', x: 380, z: 280, line: 'Flat out past the tower, then hard left at the fuel drums!', speaker: 'mara' },
      { type: 'escape', label: 'Outrun the losers’ friends', x: 380, z: 280, line: 'They never could lose clean. Neither can we.', speaker: 'mara' },
    ] },
  { id: 'j6', no: 6, title: 'THE LONG BRIDGE', contact: 'ivo', payout: 7800, blurb: 'Ivo cracked the toll cameras. Cross the causeway with the whole city watching.',
    stages: [
      { type: 'goto', label: 'Pick up Ivo at Neon Quay', x: 0, z: -280, line: 'Cameras blind for nine minutes. Drive like the tide is behind you.', speaker: 'ivo' },
      { type: 'drive', label: 'Cross Pelican Causeway with the package', x: 420, z: 0, line: 'They will come the moment the cameras wake. Do not stop.', speaker: 'ivo' },
      { type: 'escape', label: 'Lose the cops before the scanner closes', x: 420, z: 0, line: 'Scanner window closing — break line of sight, now!', speaker: 'ivo' },
      { type: 'deliver', label: 'Bring the package home', x: -210, z: 150, line: 'Nine minutes, whole city, zero cameras. Beautiful.', speaker: 'ivo' },
    ] },
  { id: 'j7', no: 7, title: 'HARBOR FIRE', contact: 'sana', payout: 9000, blurb: 'The Dredgers torch a Neon Quay club. Sana spots the arson crew from the roofs.',
    stages: [
      { type: 'goto', label: 'Reach the burning club', x: -68, z: -262, line: 'Four of them, rooftops north side. I have them marked.', speaker: 'sana' },
      { type: 'kill', label: 'Stop the arson crew', count: 5, x: -68, z: -262, line: 'Venn is done hiding. Good. So are we.', speaker: 'sana' },
      { type: 'drive', label: 'Chase Venn’s boat car to Gull Point', x: -230, z: 150, line: 'He runs for the point. Cut him off at the bridge!', speaker: 'sana' },
    ] },
  { id: 'j8', no: 8, title: 'HIGH WATER MARK', contact: 'delia', payout: 12000, blurb: 'One last job: Venn’s money, Venn’s crew, Venn himself — at the marina.',
    stages: [
      { type: 'goto', label: 'Storm the marina with your crew', x: 380, z: 280, line: 'Every debt in this city comes due tonight.', speaker: 'delia' },
      { type: 'kill', label: 'Break the Dredger guard', count: 8, x: 380, z: 280, line: 'Venn! Your tide went out. Come and see it.', speaker: 'venn' },
      { type: 'drive', label: 'Run the money home across the causeway', x: -210, z: 150, line: 'The whole lagoon is ours again, Rook. Drive it home.', speaker: 'delia' },
      { type: 'talk', label: 'Close the books at the Boathouse', x: -210, z: 150, line: 'High water mark, Rook. Nobody forgets tonight.', speaker: 'delia' },
    ] },
];

export const WEAPONS = [
  { id: 'fists', name: 'FISTS', slot: 0, damage: 12, auto: false, range: 3, ammo: Infinity, reserve: Infinity, price: 0 },
  { id: 'pistol', name: 'HARBOUR P9', slot: 1, damage: 25, auto: false, range: 60, ammo: 12, reserve: 96, price: 800 },
  { id: 'smg', name: 'WASP SMG', slot: 2, damage: 16, auto: true, range: 45, ammo: 32, reserve: 160, price: 2200 },
  { id: 'shotgun', name: 'BREAKER 12G', slot: 3, damage: 60, auto: false, range: 22, ammo: 6, reserve: 48, price: 1800 },
  { id: 'rifle', name: 'KESTREL AR', slot: 4, damage: 34, auto: true, range: 90, ammo: 30, reserve: 120, price: 3500 },
];

export const VEHICLE_MODELS = [
  { id: 'peregrine', name: 'PEREGRINE S', kind: 'sports', topSpeed: 62, accel: 26, color: 0xff2e88, price: 42000 },
  { id: 'cormorant', name: 'CORMORANT', kind: 'sedan', topSpeed: 40, accel: 16, color: 0x3f6fb5, price: 9000 },
  { id: 'egret', name: 'EGRET TAXI', kind: 'taxi', topSpeed: 42, accel: 17, color: 0xffc933, price: 11000 },
  { id: 'osprey', name: 'OSPREY SUV', kind: 'suv', topSpeed: 44, accel: 15, color: 0x4a9e6a, price: 16000 },
  { id: 'tern', name: 'TERN PICKUP', kind: 'truck', topSpeed: 38, accel: 13, color: 0xb5502a, price: 13000 },
  { id: 'gannet', name: 'GANNET VAN', kind: 'van', topSpeed: 34, accel: 11, color: 0x8a8f98, price: 8000 },
  { id: 'interceptor', name: 'KLPD INTERCEPTOR', kind: 'police', topSpeed: 58, accel: 24, color: 0x14181f, price: 0 },
  { id: 'sunbeam', name: 'SUNBEAM GT', kind: 'sports', topSpeed: 58, accel: 24, color: 0xffb020, price: 38000 },
];

export const POLICE_UNITS = ['OSPREY-12', 'GULL-7', 'TERN-22', 'PELICAN-4', 'CORMORANT-9', 'EGRET-31', 'KITE-1', 'HERON-5'];

export const RADIO = [
  { id: 'lagoon', freq: 'LAGOON 88.3', genre: 'Lagoon soul', color: '#4de3ff',
    tracks: [
      { title: 'Salt Air', artist: 'The Gull Notes' }, { title: 'Low Water Love', artist: 'Marina Vale' },
      { title: 'Causeway Lights', artist: 'Pete Harrow' }, { title: 'Stilt Row Serenade', artist: 'The Gull Notes' },
    ] },
  { id: 'neon', freq: 'NEON 104.6', genre: 'Synthwave', color: '#ff5d8f',
    tracks: [
      { title: 'Midnight Quay', artist: 'Vector Palms' }, { title: 'Chrome Tide', artist: 'Night Arcade' },
      { title: 'Afterglow Run', artist: 'Vector Palms' }, { title: 'Pink Horizon', artist: 'Lumen Kids' },
    ] },
  { id: 'reef', freq: 'REEF FM 97.5', genre: 'Island rock', color: '#ffd166',
    tracks: [
      { title: 'Breakwater', artist: 'The Shallows' }, { title: 'Harbor Fire', artist: 'Copper Kite' },
      { title: 'Glass Tide', artist: 'The Shallows' }, { title: 'High Water', artist: 'Copper Kite' },
    ] },
];

export const REP_TITLES = ['DRIFTER', 'WHEELMAN', 'HUSTLER', 'BAY RUNNER', 'LAGOON LEGEND'];
export const REP_NEEDS = [0, 400, 1200, 2400, 4200];

export const COLLECTIBLE_NAME = 'Gull Cache';
export const COLLECTIBLE_COUNT = 20;

export const RACES = [
  { id: 'r1', name: 'CAUSEWAY SPRINT', prize: 2500, laps: 1, x: 360, z: 0,
    checkpoints: [{ x: 420, z: 0 }, { x: 228, z: 0 }, { x: 0, z: 0 }, { x: -304, z: 0 }] },
  { id: 'r2', name: 'NEON QUAY CIRCUIT', prize: 4000, laps: 2, x: 0, z: -280,
    checkpoints: [{ x: 152, z: -280 }, { x: 152, z: -76 }, { x: 0, z: -76 }, { x: -152, z: -280 }] },
  { id: 'r3', name: 'AIRSTRIP DRAG', prize: 6000, laps: 1, x: 380, z: 280,
    checkpoints: [{ x: 400, z: 200 }, { x: 400, z: 340 }, { x: 304, z: 228 }, { x: 228, z: 304 }] },
];

// The 20 Gull Caches: small brass gulls hidden around the lagoon, $250 each.
export const CACHES = [
  { id: 'cache-01', x: -210, z: 150 }, { id: 'cache-02', x: 380, z: 280 },
  { id: 'cache-03', x: 0, z: -280 }, { id: 'cache-04', x: -380, z: -280 },
  { id: 'cache-05', x: 220, z: 0 }, { id: 'cache-06', x: -220, z: -260 },
  { id: 'cache-07', x: 420, z: 0 }, { id: 'cache-08', x: -380, z: 150 },
  { id: 'cache-09', x: 120, z: -140 }, { id: 'cache-10', x: -120, z: 260 },
  { id: 'cache-11', x: 0, z: 140 }, { id: 'cache-12', x: 60, z: 60 },
  { id: 'cache-13', x: -230, z: 150 }, { id: 'cache-14', x: 400, z: 320 },
  { id: 'cache-15', x: -360, z: 40 }, { id: 'cache-16', x: 152, z: -76 },
  { id: 'cache-17', x: -152, z: 228 }, { id: 'cache-18', x: 304, z: 228 },
  { id: 'cache-19', x: 228, z: -228 }, { id: 'cache-20', x: -304, z: -76 },
];

export const CREW_UNLOCK = {
  mara: 'Complete SALT RUN (CH2)',
  ivo: 'Complete NIGHT MARKET (CH3)',
  sana: 'Complete SIREN SONG (CH4)',
};

export const CREW_COOLDOWN = { mara: 45, ivo: 30, sana: 25 }; // seconds per ability

export const PROPERTIES = [
  { id: 'anchor', name: 'THE RUSTY ANCHOR', kind: 'Bar', price: 25000, income: 400, x: -220, z: -60 },
  { id: 'garage', name: 'STILT ROW GARAGE', kind: 'Garage', price: 18000, income: 300, x: -360, z: 40 },
];

export const SHOPS = [
  { id: 'arms', name: 'HARBOR ARMS', kind: 'Weapons', x: 120, z: -140 },
  { id: 'auto', name: 'LAGOON AUTO', kind: 'Respray + repair', x: -120, z: 260 },
  { id: 'boathouse', name: 'THE BOATHOUSE', kind: 'Safehouse', x: -210, z: 150 },
];

export function districtAt(x, z) {
  for (const d of DISTRICTS) if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return d;
  return { id: 'lagoon', name: 'THE LAGOON', heat: 0, blurb: 'Open water.' };
}

export function repLevel(rep) {
  let lvl = 0;
  for (let i = 0; i < REP_NEEDS.length; i++) if (rep >= REP_NEEDS[i]) lvl = i;
  return lvl; // 0..4
}

// Contacts and crew share one id space for speakers ('delia', 'mara', ...).
export function personById(id) {
  return CONTACTS.find((c) => c.id === id) || CREW.find((c) => c.id === id) ||
    { id, name: id, role: '', color: '#888888', skin: '#c98d5f', hair: '#222222', hairStyle: 'short' };
}
