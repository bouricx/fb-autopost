import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect,it } from 'vitest';
import { AppDatabase } from '../electron/core/database';
it('backs up existing version 8 rows before identity migration and preserves them on reopen',()=>{
 const root=mkdtempSync(join(tmpdir(),'autopost-upgrade-')),file=join(root,'app.sqlite');
 let db:AppDatabase|undefined;
 try{
  db=new AppDatabase(file);const account=db.createAccount({name:'preserve fixture',adapterType:'discord-webhook'},null,null);db.close();db=undefined;
  const old=new Database(file);
  try{
   for(const column of ['facebook_user_id','facebook_name','facebook_photo_url','facebook_actor_type','facebook_identity_checked_at'])old.exec(`ALTER TABLE accounts DROP COLUMN ${column}`);
   old.exec('DELETE FROM schema_migrations WHERE version=9');
  }finally{old.close();}
  db=new AppDatabase(file);expect(db.accountRecord(account.id)?.name).toBe('preserve fixture');
  expect(db.db.prepare('SELECT version FROM schema_migrations WHERE version=9').get()).toBeDefined();
  const backups=readdirSync(root).filter(name=>name.endsWith('.bak'));expect(backups).toHaveLength(1);
  const snapshot=new Database(join(root,backups[0]),{readonly:true});
  try{expect(snapshot.prepare('SELECT name FROM accounts WHERE id=?').get(account.id)).toMatchObject({name:'preserve fixture'});expect(snapshot.prepare('SELECT version FROM schema_migrations WHERE version=9').get()).toBeUndefined();}finally{snapshot.close();}
  db.close();db=new AppDatabase(file);expect(readdirSync(root).filter(name=>name.endsWith('.bak'))).toHaveLength(1);
 }finally{db?.close();rmSync(root,{recursive:true,force:true});}
});
