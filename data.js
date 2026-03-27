// WTC 2026 Map Pack Data
const WTC_DEPLOYMENTS = [
  'Hammer and Anvil',
  'Crucible of Battle',
  'Search and Destroy',
];

// BETA deployments (optional)
const WTC_DEPLOYMENTS_BETA = [
  'Dawn of War',
  'Sweeping Engagement',
];

const WTC_MAPS = {
  'Hammer and Anvil': [
    { id: 'ha1', name: 'Hammer and Anvil 1' },
    { id: 'ha2', name: 'Hammer and Anvil 2' },
    { id: 'ha3', name: 'Hammer and Anvil 3' },
    { id: 'ha45', name: 'Hammer and Anvil 4-5' },
    { id: 'ha6', name: 'Hammer and Anvil 6' },
    { id: 'ha7', name: 'Hammer and Anvil 7' },
    { id: 'ha8', name: 'Hammer and Anvil 8' },
  ],
  'Crucible of Battle': [
    { id: 'cb1', name: 'Crucible of Battle 1' },
    { id: 'cb2', name: 'Crucible of Battle 2' },
    { id: 'cb3', name: 'Crucible of Battle 3' },
    { id: 'cb45', name: 'Crucible of Battle 4-5' },
    { id: 'cb6', name: 'Crucible of Battle 6' },
    { id: 'cb7', name: 'Crucible of Battle 7' },
    { id: 'cb8', name: 'Crucible of Battle 8' },
  ],
  'Search and Destroy': [
    { id: 'sd1', name: 'Search and Destroy 1' },
    { id: 'sd2', name: 'Search and Destroy 2' },
    { id: 'sd3', name: 'Search and Destroy 3' },
    { id: 'sd45', name: 'Search and Destroy 4-5' },
    { id: 'sd6', name: 'Search and Destroy 6' },
    { id: 'sd7', name: 'Search and Destroy 7' },
    { id: 'sd8', name: 'Search and Destroy 8' },
  ],
  'Dawn of War': [
    { id: 'dow1', name: 'Dawn of War 1' },
    { id: 'dow2', name: 'Dawn of War 2' },
    { id: 'dow3', name: 'Dawn of War 3' },
    { id: 'dow4', name: 'Dawn of War 4 (BETA)' },
    { id: 'dow5', name: 'Dawn of War 5 (BETA)' },
    { id: 'dow6', name: 'Dawn of War 6 (BETA)' },
  ],
  'Sweeping Engagement': [
    { id: 'se1', name: 'Sweeping Engagement 1' },
    { id: 'se2', name: 'Sweeping Engagement 2' },
    { id: 'se3', name: 'Sweeping Engagement 3' },
    { id: 'se4', name: 'Sweeping Engagement 4 (BETA)' },
    { id: 'se5', name: 'Sweeping Engagement 5 (BETA)' },
    { id: 'se6', name: 'Sweeping Engagement 6 (BETA)' },
  ],
};

// Hidden Supplies variants for H&A maps
const WTC_HIDDEN_SUPPLIES_MAPS = [
  'ha1', 'ha2', 'ha3', 'ha45', 'ha6', 'ha7', 'ha8'
];

// Chapter Approved 2025 Missions (Pariah Nexus / Leviathan)
const WTC_MISSIONS = [
  { id: 'supply_drop', name: 'Supply Drop' },
  { id: 'sites_of_power', name: 'Sites of Power' },
  { id: 'take_and_hold', name: 'Take and Hold' },
  { id: 'the_ritual', name: 'The Ritual' },
  { id: 'priority_targets', name: 'Priority Targets' },
  { id: 'scorched_earth', name: 'Scorched Earth' },
  { id: 'purge_the_foe', name: 'Purge the Foe' },
  { id: 'vital_ground', name: 'Vital Ground' },
  { id: 'deploy_servo_skulls', name: 'Deploy Servo-Skulls' },
];

// The 8 WTC tables map to these map indices within a deployment type.
// Map "4-5" is used for both table 4 and table 5.
const WTC_TABLE_MAP_INDICES = [0, 1, 2, 3, 3, 4, 5, 6];
// Readable labels for the tables
const WTC_TABLE_LABELS = ['Map 1', 'Map 2', 'Map 3', 'Map 4-5', 'Map 4-5', 'Map 6', 'Map 7', 'Map 8'];

// Common 40k Factions for autofill suggestions
const FACTIONS_40K = [
  'Adepta Sororitas',
  'Adeptus Custodes',
  'Adeptus Mechanicus',
  'Aeldari',
  'Agents of the Imperium',
  'Astra Militarum',
  'Black Templars',
  'Blood Angels',
  'Chaos Daemons',
  'Chaos Knights',
  'Chaos Space Marines',
  'Dark Angels',
  'Death Guard',
  'Deathwatch',
  'Drukhari',
  'Emperor\'s Children',
  'Genestealer Cults',
  'Grey Knights',
  'Imperial Fists',
  'Imperial Knights',
  'Iron Hands',
  'Leagues of Votann',
  'Necrons',
  'Orks',
  'Raven Guard',
  'Salamanders',
  'Space Marines',
  'Space Wolves',
  'T\'au Empire',
  'Thousand Sons',
  'Tyranids',
  'Ultramarines',
  'White Scars',
  'World Eaters',
];

// Space Marine chapters that count as the same "Space Marines" faction slot.
// Grey Knights are NOT in this list — they are a separate faction.
const SPACE_MARINE_CHAPTERS = [
  'Space Marines',
  'Black Templars',
  'Blood Angels',
  'Dark Angels',
  'Deathwatch',
  'Imperial Fists',
  'Iron Hands',
  'Raven Guard',
  'Salamanders',
  'Space Wolves',
  'Ultramarines',
  'White Scars',
];

// Unique factions for team building (each entry is one faction "slot").
// One SM chapter per team is allowed, so we list all chapters as options for
// the single SM slot. All non-SM factions are their own slot.
const UNIQUE_FACTIONS = [
  'Adepta Sororitas',
  'Adeptus Custodes',
  'Adeptus Mechanicus',
  'Aeldari',
  'Agents of the Imperium',
  'Astra Militarum',
  'Chaos Daemons',
  'Chaos Knights',
  'Chaos Space Marines',
  'Death Guard',
  'Drukhari',
  'Emperor\'s Children',
  'Genestealer Cults',
  'Grey Knights',
  'Imperial Knights',
  'Leagues of Votann',
  'Necrons',
  'Orks',
  'T\'au Empire',
  'Thousand Sons',
  'Tyranids',
  'World Eaters',
];

const WTC_COUNTRIES = [
  'Argentina',
  'Australia',
  'Austria',
  'Belarus',
  'Belgium',
  'Brazil',
  'Bulgaria',
  'Canada',
  'Chile',
  'China',
  'Colombia',
  'Croatia',
  'Czech Republic',
  'Denmark',
  'England',
  'Estonia',
  'Finland',
  'France',
  'Germany',
  'Greece',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Ireland',
  'Israel',
  'Italy',
  'Japan',
  'Kazakhstan',
  'Latvia',
  'Lithuania',
  'Luxembourg',
  'Malaysia',
  'Mexico',
  'Netherlands',
  'New Zealand',
  'Nigeria',
  'Northern Ireland',
  'Norway',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Romania',
  'Russia',
  'Scotland',
  'Serbia',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'South Africa',
  'South Korea',
  'Spain',
  'Sweden',
  'Switzerland',
  'Taiwan',
  'Thailand',
  'Turkey',
  'Ukraine',
  'Uruguay',
  'USA',
  'Venezuela',
  'Vietnam',
  'Wales',
];

