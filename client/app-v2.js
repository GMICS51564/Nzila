import {osrmRoute,geocodeCongo} from '../Asset/JS/nzila-utils.js';
import {flushClientQueue,queueClientAction} from './offline.js';

window.NZILA_V2={paymentMethod:'cash',quote:null};

function nzcV2Toast(t){
  if(typeof window.toast==='function') window.toast(t);
  else console.log(t);
}

function addPaymentUI(){
  const host=document.querySelector('[onclick="createRide()"]')?.parentElement;
  if(!host||document.getElementById('nzilaPaymentChoice')) return;

  const box=document.createElement('div');
  box.id='nzilaPaymentChoice';
  box.className='card';
  box.style.cssText='padding:13px;margin:12px 0';

  box.innerHTML=`
    <div class="label">Paiement</div>
    <div class="seg">
      <button id="payCash" class="active">💵 Espèces</button>
      <button id="payMtn">🟡 MTN</button>
    </div>
    <div class="seg" style="margin-top:5px">
      <button id="payAirtel">🔴 Airtel</button>
      <button id="payCard" disabled>Carte — bientôt</button>
    </div>
    <div id="nzilaQuote" class="muted" style="margin-top:9px">
      Le tarif sera calculé selon l’itinéraire réel.
    </div>
  `;

  host.parentElement.insertBefore(box,host);

  const set=m=>{
    window.NZILA_V2.paymentMethod=m;

    document
      .querySelectorAll('#nzilaPaymentChoice .seg button')
      .forEach(b=>b.classList.remove('active'));

    document
      .getElementById(
        m==='cash'
          ?'payCash'
          :m==='mtn'
            ?'payMtn'
            :'payAirtel'
      )
      ?.classList.add('active');
  };

  $('payCash').onclick=()=>set('cash');
  $('payMtn').onclick=()=>set('mtn');
  $('payAirtel').onclick=()=>set('airtel');
}

async function quoteRide(){

  const pickup=await getCurrentPosition();

  const destination=$('destination')?.value.trim();

  if(!destination) return null;

  const dest=await geocodeCongo(destination+', Congo');

  const route=await osrmRoute(
    {
      lat:pickup.coords.latitude,
      lng:pickup.coords.longitude
    },
    dest
  );

  const q=await sb.rpc(
    'nzila_quote_ride',
    {
      p_distance_km:route.distance_km,
      p_duration_min:route.duration_min,
      p_at:new Date().toISOString(),
      p_passengers:passengers,
      p_bags:bags
    }
  );

  if(q.error) throw q.error;

  window.NZILA_V2.quote={
    ...route,
    ...q.data,
    dest
  };

  const e=$('nzilaQuote');

  if(e){
    e.textContent=
      `${route.distance_km.toFixed(1)} km · `+
      `${Math.round(route.duration_min)} min · `+
      `estimation `+
      `${Number(q.data.estimated_price).toLocaleString('fr-FR')} FCFA`;
  }

  return window.NZILA_V2.quote;
}

async function createRideV2(){

  if(!user?.id) return;

  const btn=document.querySelector('[onclick="createRide()"]');

  if(btn?.dataset.busy==='1') return;

  if(btn){
    btn.dataset.busy='1';
    btn.disabled=true;
  }

  try{

    const department=$('department').value;
    const pickup=$('pickup').value.trim();
    const destination=$('destination').value.trim();

    if(!department||!pickup||!destination){
      throw new Error(
        'Département, départ et destination sont requis.'
      );
    }

    if(
      mode==='schedule' &&
      (!$('rideDate').value||!$('rideTime').value)
    ){
      throw new Error(
        'Choisissez une date et une heure.'
      );
    }

    const scheduled=
      mode==='schedule'
        ?new Date(
          $('rideDate').value+
          'T'+
          $('rideTime').value
        )
        :null;

    if(
      scheduled &&
      scheduled<=new Date()
    ){
      throw new Error(
        'Choisissez une date et une heure futures.'
      );
    }

    let quote=null;

    try{

      quote=await quoteRide();

    }catch(e){

      nzcV2Toast(
        'Itinéraire indisponible : tarif local conservé.'
      );
    }

    const [lat,lng]=await getPickupCoords();

    const priceValue=
      quote?.estimated_price||
      price();

    const {data,error}=await sb.rpc(
      'nzila_create_ride_app',
      {
        p_user_id:user.id,

        p_pickup_address:pickup,

        p_destination_address:destination,

        p_estimated_price:priceValue,

        p_payment_method:
          window.NZILA_V2.paymentMethod==='mtn'
            ?'mtn'
            :window.NZILA_V2.paymentMethod==='airtel'
              ?'airtel'
              :'cash',

        p_pickup_latitude:lat,

        p_pickup_longitude:lng,

        p_destination_latitude:
          quote?.dest.lat||null,

        p_destination_longitude:
          quote?.dest.lng||null
      }
    );

    if(error) throw error;

    const rideId=
      data?.ride_id||
      data?.id;

    if(!rideId){
      throw new Error(
        'COURSE_ID_MISSING'
      );
    }

    activeRideId=rideId;

    localStorage.setItem(
      'nzila_active_ride',
      rideId
    );

    if(quote){

      await sb.rpc(
        'nzila_apply_route_data',
        {
          p_ride_id:rideId,

          p_user_id:user.id,

          p_distance_km:
            quote.distance_km,

          p_duration_min:
            quote.duration_min,

          p_destination_latitude:
            quote.dest.lat,

          p_destination_longitude:
            quote.dest.lng,

          p_estimated_price:
            quote.estimated_price,

          p_surge_multiplier:
            quote.surge_multiplier
        }
      );
    }

    if(scheduled){

      const sr=await sb.rpc(
        'nzila_schedule_ride',
        {
          p_ride_id:rideId,

          p_user_id:user.id,

          p_scheduled_at:
            scheduled.toISOString(),

          p_pickup_latitude:lat,

          p_pickup_longitude:lng,

          p_destination_latitude:
            quote?.dest.lat||null,

          p_destination_longitude:
            quote?.dest.lng||null
        }
      );

      if(sr.error) throw sr.error;

      nzcV2Toast(
        'Course programmée. Dispatch automatique environ 20 min avant.'
      );

    }else{

      const match=await sb.rpc(
        'nzila_match_ride',
        {
          p_ride_id:rideId
        }
      );

      if(match.error){
        console.warn(
          match.error.message
        );
      }
    }

    const {data:ride}=await sb
      .from('rides')
      .select('*')
      .eq('id',rideId)
      .maybeSingle();

    if(ride){

      showRideModal(ride);

      subscribeToRide(rideId);

      if(
        ride.status==='accepted' &&
        window.NZILA_V2.paymentMethod!=='cash'
      ){
        await startMobilePayment(ride);
      }
    }

  }catch(e){

    if(!navigator.onLine){

      queueClientAction({
        rpc:'nzila_create_ride_app',

        args:{
          p_user_id:user.id,

          p_pickup_address:
            $('pickup').value.trim(),

          p_destination_address:
            $('destination').value.trim(),

          p_estimated_price:
            price(),

          p_payment_method:'cash'
        }
      });
    }

    nzcV2Toast(
      'Course : '+
      (e.message||e)
    );

  }finally{

    if(btn){

      btn.disabled=false;

      btn.dataset.busy='0';
    }
  }
}

async function startMobilePayment(ride){

  try{

    const r=
      await sb.functions.invoke(
        'payment-create',
        {
          body:{
            ride_id:ride.id,
            method:
              window.NZILA_V2.paymentMethod
          }
        }
      );

    if(r.error) throw r.error;

    if(r.data?.payment_url){

      window.open(
        r.data.payment_url,
        '_blank',
        'noopener'
      );

      nzcV2Toast(
        'Guichet Mobile Money ouvert. Le statut sera confirmé automatiquement.'
      );
    }

  }catch(e){

    nzcV2Toast(
      'Paiement Mobile Money : '+
      (e.message||e)
    );
  }
}

async function cancelActiveRideV2(){

  if(!activeRideId){

    return nzcV2Toast(
      'Aucune course active.'
    );
  }

  const {data:p}=await sb
    .from('ride_payments')
    .select('*')
    .eq('ride_id',activeRideId)
    .maybeSingle();

  const {error}=await sb.rpc(
    'nzila_update_ride_status',
    {
      p_ride_id:activeRideId,
      p_status:'cancelled'
    }
  );

  if(error){

    if(!navigator.onLine){

      queueClientAction({
        rpc:'nzila_update_ride_status',

        args:{
          p_ride_id:activeRideId,
          p_status:'cancelled'
        }
      });
    }

    return nzcV2Toast(
      error.message
    );
  }

  if(
    p?.status==='paid' &&
    p.id
  ){

    try{

      await sb.functions.invoke(
        'payment-refund',
        {
          body:{
            payment_id:p.id,
            reason:'Course annulée'
          }
        }
      );

    }catch(e){}
  }

  activeRideId=null;

  localStorage.removeItem(
    'nzila_active_ride'
  );

  nzcV2Toast(
    'Course annulée.'
  );

  if(
    typeof closeRideModal==='function'
  ){
    closeRideModal();
  }
}

window.addEventListener(
  'online',
  ()=>{
    flushClientQueue(
      sb,
      nzcV2Toast
    );
  }
);

window.addEventListener(
  'DOMContentLoaded',
  ()=>{
    addPaymentUI();

    setTimeout(
      addPaymentUI,
      500
    );

    if(navigator.onLine){

      flushClientQueue(
        sb,
        nzcV2Toast
      );
    }
  }
);

window.createRide=createRideV2;

window.cancelActiveRide=
  cancelActiveRideV2;
