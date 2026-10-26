import { afterEach, expect, it, vi } from "vitest";
import { resolve, join } from "node:path";
const mocks=vi.hoisted(()=>({verify:vi.fn()}));
vi.mock('electron',()=>({clipboard:{},dialog:{},safeStorage:{}}));
vi.mock('../electron/accounts/cookie-login',async importOriginal=>{
 const actual=await importOriginal<typeof import('../electron/accounts/cookie-login')>();
 return {...actual,CookieLogin:class{verify(...args:unknown[]){return mocks.verify(...args);}}};
});
import { AppDatabase } from '../electron/core/database';
import { AccountManager } from '../electron/accounts/account-manager';
import type { SecretVault } from '../electron/core/secrets';
import type { SessionChecker } from '../electron/accounts/session-checker';
let databases:AppDatabase[]=[];
afterEach(()=>{databases.forEach(db=>db.close());databases=[];vi.clearAllMocks();});
function setup(){
 const db=new AppDatabase(':memory:');databases.push(db);
 const close=vi.fn().mockResolvedValue(undefined),cookieRoot=resolve('fixture-cookie-profiles');
 const vault={decrypt:()=> 'c_user=123456; xs=fixture-only'} as unknown as SecretVault;
 mocks.verify.mockResolvedValue({session:{status:'online',message:'verified',checkedAt:new Date().toISOString(),identity:{userId:'123456',name:'Fixture',photoUrl:null,actorType:'profile'}},encryptedCookies:'encrypted-fixture',format:'raw'});
 return{db,close,cookieRoot,manager:new AccountManager(db,vault,resolve('fixture-legacy'),{} as SessionChecker,close,cookieRoot)};
}
it('imports an account to the c_user profile and reuses it on explicit cookie replacement',async()=>{
 const {manager,db,cookieRoot}=setup();const [first]=await manager.importMultipleCookies('c_user=123456; xs=fixture-only');
 expect(first.status).toBe('online');expect(db.accountRecord(first.accountId)).toMatchObject({browserProfilePath:join(cookieRoot,'123456'),facebookUserId:'123456'});
 const [next]=await manager.importMultipleCookies('c_user=123456; xs=new-fixture');expect(next.accountId).toBe(first.accountId);expect(db.listAccounts()).toHaveLength(1);
 expect(db.sessionRecord(first.accountId)?.encryptedCookies).toBe('encrypted-fixture');
});
it('migrates a selected legacy account only on explicit cookie import and rejects a different identity',async()=>{
 const {manager,db}=setup();const a=db.createAccount({name:'Legacy',adapterType:'facebook-browser'},null,resolve('fixture-legacy/account'));
 await manager.importCookieForAccount(a.id,'c_user=123456; xs=fixture-only');
 await expect(manager.importCookieForAccount(a.id,'c_user=654321; xs=fixture-only')).rejects.toThrow(/คนละบัญชี/);expect(mocks.verify).toHaveBeenCalledTimes(1);
});
it('checkpoint stops batch processing and does not activate or retry the account',async()=>{
 const {manager,db}=setup();mocks.verify.mockResolvedValue({session:{status:'checkpoint',reason:'checkpoint_or_login_required',message:'checkpoint_or_login_required',checkedAt:new Date().toISOString()},encryptedCookies:'encrypted-fixture',format:'raw'});
 const rows=await manager.importMultipleCookies('c_user=123456; xs=fixture-only\n---ACCOUNT---\nc_user=654321; xs=second-fixture');expect(rows).toHaveLength(1);expect(db.listAccounts()).toHaveLength(1);expect(mocks.verify).toHaveBeenCalledTimes(1);expect(db.accountRecord(rows[0].accountId)?.status).toBe('needs_login');
});
it('checking an account without an encrypted cookie never opens manual login',async()=>{
 const {manager,db}=setup();const a=db.createAccount({name:'Old',adapterType:'facebook-browser'},null,resolve('fixture-legacy/account'));
 expect(await manager.checkSession(a.id)).toMatchObject({reason:'missing_c_user_or_xs'});expect(mocks.verify).not.toHaveBeenCalled();await expect(manager.loginWithBrowser(a.id)).rejects.toThrow('manual_login_disabled');await expect(manager.createAndLoginWithBrowser('new')).rejects.toThrow('manual_login_disabled');
});
it('restores encrypted cookies through the verifier and preserves an intentional account pause',async()=>{
 const {manager,db}=setup();const [a]=await manager.importMultipleCookies('c_user=123456; xs=fixture-only');db.setAccountStatus(a.accountId,'paused');await manager.checkSession(a.accountId);expect(mocks.verify).toHaveBeenCalledTimes(2);expect(db.accountRecord(a.accountId)?.status).toBe('paused');
});
it('reuses an older encrypted-cookie account even if its display identity was never verified',async()=>{
 const {manager,db}=setup();const legacy=db.createAccount({name:'Old custom label',adapterType:'facebook-browser'},null,resolve('fixture-legacy/old-profile'));
 db.saveSession(legacy.id,'encrypted-fixture','raw','unknown','unverified',new Date().toISOString());
 const destination=db.createDestination({accountId:legacy.id,kind:'facebook_group',name:'Fixture',url:'https://www.facebook.com/groups/123/'});
 const [job]=db.createJobs({accountId:legacy.id,destinationIds:[destination.id],caption:'Fixture',media:[],runAt:new Date().toISOString()});
 db.db.prepare("UPDATE jobs SET status='uncertain',submission_state='unknown' WHERE id=?").run(job.id);
 const [result]=await manager.importMultipleCookies('c_user=123456; xs=fixture-only');expect(result.accountId).toBe(legacy.id);expect(db.listAccounts()).toHaveLength(1);expect(db.job(job.id)).toMatchObject({status:'uncertain',submissionState:'unknown'});
});
it('serializes credential replacement by c_user across two previously unbound account records',async()=>{
 const {manager,db}=setup();const a=db.createAccount({name:'A',adapterType:'facebook-browser'},null,resolve('fixture-legacy/a'));const b=db.createAccount({name:'B',adapterType:'facebook-browser'},null,resolve('fixture-legacy/b'));
 let finish!:(value:unknown)=>void;mocks.verify.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const first=manager.importCookieForAccount(a.id,'c_user=123456; xs=fixture-only');
 await vi.waitFor(()=>expect(mocks.verify).toHaveBeenCalledTimes(1));
 await expect(manager.importCookieForAccount(b.id,'c_user=123456; xs=fixture-only')).rejects.toThrow(/กำลังตรวจสอบ/);
 finish({session:{status:'online',message:'verified',checkedAt:new Date().toISOString(),identity:{userId:'123456',name:'Fixture',photoUrl:null,actorType:'profile'}},encryptedCookies:'encrypted-fixture',format:'raw'});await first;
 expect(mocks.verify).toHaveBeenCalledTimes(1);expect(db.sessionRecord(b.id)?.encryptedCookies).toBeNull();
});
