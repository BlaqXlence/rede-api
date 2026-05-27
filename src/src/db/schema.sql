-- REDE Database Schema
-- Run this on your PostgreSQL database (Supabase, Railway, or local)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone       VARCHAR(20) UNIQUE NOT NULL,
  name        VARCHAR(100),
  email       VARCHAR(150),
  avatar_url  TEXT,
  verified    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- OTP codes table (for phone verification)
CREATE TABLE IF NOT EXISTS otps (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone       VARCHAR(20) NOT NULL,
  code        VARCHAR(6) NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  used        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title            VARCHAR(100) NOT NULL,
  description      TEXT NOT NULL,
  category         VARCHAR(30) NOT NULL,
  cover_image      TEXT,
  start_time       TIMESTAMP NOT NULL,
  end_time         TIMESTAMP NOT NULL,
  location_name    VARCHAR(200) NOT NULL,
  location_address VARCHAR(300),
  location_lat     DECIMAL(10, 7),
  location_lng     DECIMAL(10, 7),
  organizer_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  max_attendees    INTEGER,
  entry_fee        INTEGER DEFAULT 0,
  original_fee     INTEGER,
  tags             TEXT[] DEFAULT '{}',
  attendee_count   INTEGER DEFAULT 0,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

-- Attendees table (who joined what event)
CREATE TABLE IF NOT EXISTS attendees (
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- Indexes for fast geo queries and lookups
CREATE INDEX IF NOT EXISTS idx_events_category    ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_start_time  ON events(start_time);
CREATE INDEX IF NOT EXISTS idx_events_location    ON events(location_lat, location_lng);
CREATE INDEX IF NOT EXISTS idx_events_organizer   ON events(organizer_id);
CREATE INDEX IF NOT EXISTS idx_attendees_user     ON attendees(user_id);
CREATE INDEX IF NOT EXISTS idx_otps_phone         ON otps(phone);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed some real Kampala events for testing
-- (Replace organizer_id with a real user UUID after first signup)
-- INSERT INTO events (...) VALUES (...);

COMMENT ON TABLE users IS 'REDE app users - identified by phone number';
COMMENT ON TABLE events IS 'Social events created by users in Uganda';
COMMENT ON TABLE attendees IS 'Junction table - who is attending which event';
COMMENT ON TABLE otps IS 'Phone verification codes - cleaned up after 10 minutes';
