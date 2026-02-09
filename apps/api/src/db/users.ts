/**
 * User database operations
 * Note: User creation/auth is handled by better-auth
 * This file contains helper functions for custom user queries
 */

interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Find user by ID
 */
export async function findUserById(db: D1Database, userId: string): Promise<User | null> {
  const result = await db.prepare('SELECT * FROM user WHERE id = ?').bind(userId).first<User>();
  return result ?? null;
}

/**
 * Find user by email
 */
export async function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const result = await db.prepare('SELECT * FROM user WHERE email = ?').bind(email).first<User>();
  return result ?? null;
}

/**
 * Update user profile (for custom fields not managed by better-auth)
 */
export async function updateUser(
  db: D1Database,
  userId: string,
  updates: { name?: string; image?: string }
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const setClauses: string[] = ['updated_at = ?'];
  const values: (string | number)[] = [now];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    values.push(updates.name);
  }

  if (updates.image !== undefined) {
    setClauses.push('image = ?');
    values.push(updates.image);
  }

  values.push(userId);

  await db
    .prepare(`UPDATE user SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

/**
 * Delete user and all associated data
 * Note: Cascading deletes will handle sessions, accounts, machines, devices
 */
export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM user WHERE id = ?').bind(userId).run();
}
