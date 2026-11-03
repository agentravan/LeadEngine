const TAGS = {
  "gyms":[["leisure","fitness_centre"],["leisure","sports_centre"]],"gym":[["leisure","fitness_centre"],["leisure","sports_centre"]],
  "salons":[["shop","hairdresser"],["shop","beauty"]],"salon":[["shop","hairdresser"],["shop","beauty"]],
  "dentists":[["amenity","dentist"],["healthcare","dentist"]],"dentist":[["amenity","dentist"],["healthcare","dentist"]],
  "restaurants":[["amenity","restaurant"],["amenity","cafe"],["amenity","fast_food"]],"restaurant":[["amenity","restaurant"],["amenity","cafe"],["amenity","fast_food"]],
  "clinics":[["amenity","clinic"],["amenity","doctors"],["healthcare","clinic"]],"clinic":[["amenity","clinic"],["amenity","doctors"],["healthcare","clinic"]],
  "hotels":[["tourism","hotel"],["tourism","guest_house"]],"hotel":[["tourism","hotel"],["tourism","guest_house"]],
  "real estate":[["office","estate_agent"]],"coaching centres":[["amenity","school"],["amenity","college"]]
};
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({error:"Method not allowed"});
  try {
    const {niche, location, limit=50} = req.body || {};
    if (!niche || !location) return res.status(400).json({error:"Enter a niche and location."});
    const pairs = TAGS[String(niche).trim().toLowerCase()];
    if (!pairs) return res.status(400).json({error:"Unsupported niche. Try gyms, salons, dentists, restaurants, clinics, hotels, real estate or coaching centres."});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const geoUrl = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q="+encodeURIComponent(location);
      const geo = await fetch(geoUrl,{headers:{"User-Agent":"LeadEngineCRM/1.0 (business discovery tool)","Accept":"application/json"},signal:controller.signal});
      if (!geo.ok) throw new Error("Location service returned HTTP "+geo.status);
      const places = await geo.json();
      if (!places.length) return res.status(404).json({error:"Location not found. Include city and country."});
      const {lat,lon}=places[0];
      const clauses=pairs.map(([k,v])=>`nwr(around:3000,${lat},${lon})["${k}"="${v}"]["name"];`).join("");
      const query="[out:json][timeout:35];("+clauses+");out center tags;";
      const endpoints=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"];
      let data=null,lastError=null;
      for (const endpoint of endpoints) {
        try {
          const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":"LeadEngineCRM/1.0","Accept":"application/json"},body:"data="+encodeURIComponent(query),signal:controller.signal});
          if (!response.ok) throw new Error("Overpass HTTP "+response.status);
          data=await response.json(); break;
        } catch(e) { lastError=e; }
      }
      if (!data) throw new Error(lastError?.message || "Business search provider unavailable. Please retry.");
      return res.status(200).json({elements:(data.elements||[]).slice(0,Math.min(100,Math.max(1,Number(limit)||50)))});
    } finally { clearTimeout(timer); }
  } catch(e) {
    const message=e.name==="AbortError"?"Search timed out. Please retry with a smaller area.":(e.message||"Business search failed.");
    return res.status(502).json({error:message});
  }
};