from __future__ import annotations

import html
import re
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware\nfrom fastapi.staticfiles import StaticFiles\nfrom pathlib import Path
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import DateTime, Float, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://leadengine:leadengine@db:5432/leadengine"
    cors_origins: str = "http://localhost:8000,http://127.0.0.1:8000"
    user_agent: str = "LeadEngine/1.0 (local business research; configure contact email)"
    openai_api_key: Optional[str] = None


settings = Settings()
engine = create_engine(settings.database_url, pool_pre_ping=True)
Session = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Lead(Base):
    __tablename__ = "leads"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_id: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(300), index=True)
    category: Mapped[str] = mapped_column(String(80), index=True)
    city: Mapped[str] = mapped_column(String(120), index=True)
    area: Mapped[str] = mapped_column(String(160), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    phone: Mapped[str] = mapped_column(String(100), default="")
    website: Mapped[str] = mapped_column(Text, default="")
    email: Mapped[str] = mapped_column(String(300), default="")
    rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reviews: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    profile_url: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(80), default="OpenStreetMap")
    status: Mapped[str] = mapped_column(String(40), default="New Leads", index=True)
    score: Mapped[int] = mapped_column(Integer, default=0)
    priority: Mapped[str] = mapped_column(String(20), default="Low")
    notes: Mapped[str] = mapped_column(Text, default="")
    consent_to_contact: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Campaign(Base):
    __tablename__ = "campaigns"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    niche: Mapped[str] = mapped_column(String(100))
    location: Mapped[str] = mapped_column(String(300))
    count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30), default="Completed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


Base.metadata.create_all(engine)

app = FastAPI(title="LeadEngine API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in settings.cors_origins.split(",") if x.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)


class SearchRequest(BaseModel):
    niche: str = Field(min_length=2, max_length=80)
    location: str = Field(min_length=2, max_length=300)
    city: str = Field(default="Gurugram", max_length=120)
    limit: int = Field(default=50, ge=1, le=100)


class LeadPatch(BaseModel):
    status: Optional[str] = Field(default=None, max_length=40)
    notes: Optional[str] = None
    consent_to_contact: Optional[bool] = None


class HookRequest(BaseModel):
    service: str = Field(default="website and booking", max_length=100)
    demo_url: str = Field(default="", max_length=500)


ALLOWED_STATUSES = {"New Leads", "Contacted", "Qualified", "Demo Scheduled", "Closed/Won", "Lost"}
TAGS = {
    "gym": [("leisure", "fitness_centre"), ("leisure", "sports_centre")],
    "gyms": [("leisure", "fitness_centre"), ("leisure", "sports_centre")],
    "salon": [("shop", "hairdresser"), ("shop", "beauty")],
    "salons": [("shop", "hairdresser"), ("shop", "beauty")],
    "dentist": [("amenity", "dentist"), ("healthcare", "dentist")],
    "dentists": [("amenity", "dentist"), ("healthcare", "dentist")],
    "restaurant": [("amenity", "restaurant"), ("amenity", "cafe"), ("amenity", "fast_food")],
    "restaurants": [("amenity", "restaurant"), ("amenity", "cafe"), ("amenity", "fast_food")],
    "clinic": [("amenity", "clinic"), ("amenity", "doctors"), ("healthcare", "clinic")],
    "clinics": [("amenity", "clinic"), ("amenity", "doctors"), ("healthcare", "clinic")],
    "hotel": [("tourism", "hotel"), ("tourism", "guest_house"), ("tourism", "hostel")],
    "hotels": [("tourism", "hotel"), ("tourism", "guest_house"), ("tourism", "hostel")],
    "real estate": [("office", "estate_agent")],
    "coaching centre": [("amenity", "school"), ("amenity", "college")],
    "coaching centres": [("amenity", "school"), ("amenity", "college")],
}


def address_from_tags(t: dict) -> str:
    keys = ["addr:housenumber", "addr:street", "addr:suburb", "addr:neighbourhood", "addr:city", "addr:postcode"]
    return ", ".join(dict.fromkeys(str(t[k]) for k in keys if t.get(k)))


def lead_dict(x: Lead) -> dict:
    return {
        "id": x.id, "name": x.name, "category": x.category, "city": x.city, "area": x.area,
        "address": x.address, "phone": x.phone, "website": x.website, "email": x.email,
        "rating": x.rating, "reviews": x.reviews, "profile_url": x.profile_url,
        "source": x.source, "status": x.status, "score": x.score, "priority": x.priority,
        "notes": x.notes, "consent_to_contact": x.consent_to_contact,
        "created_at": x.created_at.isoformat() if x.created_at else None,
    }


@app.get("/api/health")
def health():
    with Session() as db:
        db.execute(select(1))
    return {"ok": True, "database": "connected", "source": "OpenStreetMap"}


@app.get("/api/leads")
def list_leads(status: Optional[str] = None, source: Optional[str] = None, city: Optional[str] = None,
               min_score: int = Query(default=0, ge=0, le=100), q: Optional[str] = None):
    with Session() as db:
        stmt = select(Lead).where(Lead.score >= min_score).order_by(Lead.created_at.desc())
        if status: stmt = stmt.where(Lead.status == status)
        if source: stmt = stmt.where(Lead.source == source)
        if city: stmt = stmt.where(Lead.city.ilike(f"%{city}%"))
        if q: stmt = stmt.where(Lead.name.ilike(f"%{q}%"))
        return [lead_dict(x) for x in db.scalars(stmt).all()]


@app.post("/api/search")
async def search_businesses(req: SearchRequest):
    pairs = TAGS.get(req.niche.strip().lower())
    if not pairs:
        raise HTTPException(400, "Unsupported niche. Try gyms, salons, dentists, restaurants, clinics, hotels, real estate, or coaching centres.")
    headers = {"User-Agent": settings.user_agent}
    async with httpx.AsyncClient(timeout=35, headers=headers, follow_redirects=True) as client:
        geo = await client.get("https://nominatim.openstreetmap.org/search", params={
            "q": req.location, "format": "jsonv2", "limit": 1
        })
        if geo.status_code != 200:
            raise HTTPException(502, "Nominatim geocoding is temporarily unavailable.")
        places = geo.json()
        if not places:
            raise HTTPException(404, "Location not found. Include city and country.")
        lat, lon = float(places[0]["lat"]), float(places[0]["lon"])
        clauses = [f'nwr(around:3000,{lat},{lon})["{k}"="{v}"]["name"];' for k, v in pairs]
        query = "[out:json][timeout:45];(" + "".join(clauses) + ");out center tags;"
        overpass = await client.post("https://overpass-api.de/api/interpreter", data={"data": query})
        if overpass.status_code != 200:
            raise HTTPException(502, "Overpass is busy or unavailable. Retry later; do not parallelize searches.")
        elements = overpass.json().get("elements", [])

    created = []
    with Session() as db:
        for item in elements:
            tags = item.get("tags", {})
            name = tags.get("name") or tags.get("brand") or tags.get("operator")
            if not name: continue
            source_id = f"osm:{item['type']}:{item['id']}"
            existing = db.scalar(select(Lead).where(Lead.source_id == source_id))
            if existing: continue
            website = tags.get("website") or tags.get("contact:website") or ""
            email = tags.get("email") or tags.get("contact:email") or ""
            phone = tags.get("phone") or tags.get("contact:phone") or ""
            instagram = tags.get("contact:instagram") or tags.get("instagram") or ""
            facebook = tags.get("contact:facebook") or tags.get("facebook") or ""
            score = (45 if not website else 0) + (25 if not (instagram or facebook) else 0) + (10 if not email else 0)
            profile = f"https://www.openstreetmap.org/{item['type']}/{item['id']}"
            row = Lead(
                source_id=source_id, name=name, category=req.niche, city=req.city, area=req.location,
                address=address_from_tags(tags), phone=phone, website=website, email=email,
                profile_url=profile, source="OpenStreetMap", score=score,
                priority="High" if score >= 60 else "Medium" if score >= 30 else "Low",
            )
            db.add(row); db.flush(); created.append(lead_dict(row))
        campaign = Campaign(niche=req.niche, location=req.location, count=len(created))
        db.add(campaign); db.commit()
    return {"found": len(created), "leads": created, "source": "OpenStreetMap",
            "notice": "Community data may be incomplete. Result cap is not a coverage guarantee."}


@app.patch("/api/leads/{lead_id}")
def update_lead(lead_id: str, patch: LeadPatch):
    with Session() as db:
        lead = db.get(Lead, lead_id)
        if not lead: raise HTTPException(404, "Lead not found")
        data = patch.model_dump(exclude_unset=True)
        if data.get("status") and data["status"] not in ALLOWED_STATUSES:
            raise HTTPException(400, "Invalid pipeline status")
        for key, value in data.items(): setattr(lead, key, value)
        db.commit(); db.refresh(lead)
        return lead_dict(lead)


@app.post("/api/leads/{lead_id}/hook")
def generate_hook(lead_id: str, req: HookRequest):
    with Session() as db:
        lead = db.get(Lead, lead_id)
        if not lead: raise HTTPException(404, "Lead not found")
        missing = "website" if not lead.website else "booking flow" if lead.category.lower() in {"gym", "salon", "dentist"} else "online enquiry flow"
        demo = f" Demo: {req.demo_url}" if req.demo_url else ""
        message = f"Hi {lead.name} team — I found your {lead.category.lower()} listing in {lead.area or lead.city}. Have you considered a simple {missing} to turn more local searches into enquiries? I can share a quick idea for {req.service}.{demo}"
        return {"message": message, "words": len(message.split()), "provider": "local-template",
                "note": "Review and personalize before sending. Do not send unsolicited bulk messages."}


@app.get("/api/leads/{lead_id}/whatsapp")
def whatsapp_link(lead_id: str, message: str = Query(min_length=1, max_length=1000)):
    with Session() as db:
        lead = db.get(Lead, lead_id)
        if not lead: raise HTTPException(404, "Lead not found")
        digits = re.sub(r"\D", "", lead.phone)
        if not digits: raise HTTPException(400, "No public phone number is available.")
        return {"url": f"https://wa.me/{digits}?text={quote(message)}", "requires_user_click": True}


@app.get("/api/leads/{lead_id}/banner.svg")
def banner(lead_id: str):
    with Session() as db:
        lead = db.get(Lead, lead_id)
        if not lead: raise HTTPException(404, "Lead not found")
        name = html.escape(lead.name[:45])
        niche = html.escape(lead.category.upper())
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
        <rect width="1080" height="1080" fill="#080d1d"/><path d="M0 0H1080V190H0Z" fill="#facc15"/>
        <text x="70" y="120" font-family="Arial" font-size="54" font-weight="900" fill="#090d18">LOCAL GROWTH IDEA</text>
        <text x="70" y="350" font-family="Arial" font-size="36" fill="#93c5fd">{niche}</text>
        <text x="70" y="470" font-family="Arial" font-size="66" font-weight="900" fill="#fff">{name}</text>
        <text x="70" y="600" font-family="Arial" font-size="42" fill="#e5e7eb">Turn more local searches</text>
        <text x="70" y="660" font-family="Arial" font-size="42" fill="#e5e7eb">into enquiries and bookings.</text>
        <rect x="70" y="760" width="480" height="100" rx="22" fill="#facc15"/>
        <text x="110" y="825" font-family="Arial" font-size="34" font-weight="900" fill="#090d18">LET'S BUILD YOUR DEMO</text>
        <text x="70" y="970" font-family="Arial" font-size="28" fill="#93a4c7">LeadEngine · Digital Growth Solutions</text></svg>'''
        return svg


@app.get("/api/campaigns")
def campaigns():
    with Session() as db:
        rows = db.scalars(select(Campaign).order_by(Campaign.created_at.desc())).all()
        return [{"id": x.id, "niche": x.niche, "location": x.location, "count": x.count,
                 "status": x.status, "created_at": x.created_at.isoformat()} for x in rows]
\n\n# Serve the dashboard and API from the same local origin.\nWEB_DIR = Path(__file__).resolve().parent / 'web'\napp.mount('/', StaticFiles(directory=str(WEB_DIR), html=True), name='web')\n