// Optional duration of professional experience, shared by solo and salon profiles.
export function experienceMonths(value, previous = null) {
  if (value === undefined) return previous;
  if (value === null || value === '') return null;
  const months = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(months) || months < 0 || months > 1199) {
    const error = new Error('Стаж: укажите от 0 до 99 лет и от 0 до 11 месяцев');
    error.status = 400;
    throw error;
  }
  return months;
}

export function migrateProfileExperience(db) {
  if (!db.prepare('PRAGMA table_info(profiles)').all().some(column => column.name === 'experience_months')) {
    db.exec('ALTER TABLE profiles ADD COLUMN experience_months INTEGER CHECK(experience_months IS NULL OR experience_months BETWEEN 0 AND 1199)');
  }
}
