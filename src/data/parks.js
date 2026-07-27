// Federal land the route actually touches, matched against a day's title and
// stop names so the badge appears on the right days without extra trip data.
//
// Badge art is the NPS arrowhead (public/pics/nps-arrowhead.png), supplied by
// the group. Used purely to mark which days enter federal land — informational,
// not implying any affiliation.

export const PARKS = [
  { id: 'yell', short: 'Yellowstone', re: /Yellowstone|Old Faithful|West Thumb|Sylvan Pass|Fishing Bridge|Madison Junction/i },
  { id: 'glac', short: 'Glacier', re: /Glacier|Going-to-the-Sun|Logan Pass|St\. Mary|Lake McDonald|Wild Goose Island|The Loop/i },
  { id: 'devt', short: 'Devils Tower', re: /Devils Tower/i },
  { id: 'rush', short: 'Mount Rushmore', re: /Rushmore/i },
  { id: 'libh', short: 'Little Bighorn', re: /Little Bighorn/i },
  { id: 'badl', short: 'Badlands', re: /Badlands/i },
];

// Yellowstone's own name appears in towns just outside it (West Yellowstone,
// Yellowstone Valley Inn), so a day only earns the badge if it enters the park.
const GATE_ONLY = {
  yell: /Entrance booth|Old Faithful|West Thumb|Lake Village|Fishing Bridge|Sylvan Pass|Madison Junction/i,
};

export function parksForDay(day) {
  const haystack = [day.title, day.summary, ...(day.waypoints ?? []).map((w) => w.name)].join(' · ');
  return PARKS.filter((p) => {
    if (!p.re.test(haystack)) return false;
    const gate = GATE_ONLY[p.id];
    return gate ? gate.test(haystack) : true;
  });
}
