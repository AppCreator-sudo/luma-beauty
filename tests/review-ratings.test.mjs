import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {reviewRating,reviewRatings} from '../lib/review-ratings.mjs';

test('one rating standard: completed owned visits, venue history, counts and no private data',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE appointments(id TEXT PRIMARY KEY,master_id TEXT,client_id TEXT,status TEXT);
    CREATE TABLE reviews(id TEXT PRIMARY KEY,appointment_id TEXT UNIQUE,master_id TEXT,client_id TEXT,rating INTEGER CHECK(rating BETWEEN 1 AND 5),text TEXT);
    CREATE TABLE booking_venues(appointment_id TEXT PRIMARY KEY,workspace_id TEXT);
    CREATE TABLE performers(id TEXT PRIMARY KEY,workspace_id TEXT);
    INSERT INTO performers VALUES('staff','salon-a');`);
  const visit=db.prepare('INSERT INTO appointments VALUES(?,?,?,?)'),review=db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?)'),venue=db.prepare('INSERT INTO booking_venues VALUES(?,?)');
  let n=0;
  function add(master,score,where=null,status='done',author='client'){
    const id=String(++n);visit.run(id,master,'client',status);review.run(id,id,master,author,score,'PRIVATE review text');if(where)venue.run(id,where);return id;
  }
  try{
    add('solo',4);add('solo',5);add('solo',1,null,'confirmed');add('solo',1,null,'cancelled');add('solo',1,null,'done','other-client');
    add('staff',5,'salon-a');add('former-staff',4,'salon-a');add('staff',1);add('staff',2,'salon-b');add('staff',1,'salon-a','confirmed');
    assert.deepEqual(reviewRating(db,'master','solo'),{rating:4.5,review_count:2});
    assert.deepEqual(reviewRating(db,'salon','salon-a'),{rating:4.5,review_count:2});
    assert.deepEqual(reviewRating(db,'salon','salon-b'),{rating:2,review_count:1});
    assert.deepEqual(reviewRating(db,'salon','empty'),{rating:null,review_count:0});
    db.prepare("UPDATE performers SET workspace_id='salon-b' WHERE id='staff'").run();
    assert.deepEqual(reviewRating(db,'salon','salon-a'),{rating:4.5,review_count:2},'A staff transfer must not move salon history');
    const scores=reviewRatings(db,[{kind:'master',user_id:'solo'},{kind:'salon',user_id:'salon-a'},{kind:'master',user_id:'empty'}]);
    assert.equal(scores.size,3);assert.deepEqual(scores.get('master:empty'),{rating:null,review_count:0});
    assert.equal(JSON.stringify([...scores]).includes('PRIVATE'),false);
    assert.throws(()=>review.run('duplicate','1','solo','client',5,''),/UNIQUE/,'One review per visit');
  }finally{db.close()}
});
