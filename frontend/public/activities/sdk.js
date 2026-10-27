/*
 * Parley activity SDK. Load it in a page that runs as an activity in a Parley call:
 *   <script src="https://<your parley server>/activities/sdk.js"></script>
 *
 *   const ctx = await ParleyActivity.ready()
 *     // { instance_id, channel_id, guild_id, user, participants, state }
 *   ParleyActivity.on('state', ({ state, user_id }) => …)        // shared state changed (yours too)
 *   ParleyActivity.on('message', ({ data, user_id }) => …)       // someone else sent a message
 *   ParleyActivity.on('participants', (people) => …)             // someone joined or left
 *   await ParleyActivity.setState({ … })                         // last write wins, up to 32 KB, kept for joiners
 *   await ParleyActivity.sendMessage({ … })                      // to everyone else in the activity, up to 8 KB
 *   const { code } = await ParleyActivity.authorize('identify')  // the user agrees; swap the code at /api/oauth2/token
 *   ParleyActivity.openExternal(url); ParleyActivity.close()
 *
 * Every call returns a promise that rejects with the client's error message.
 */
(function () {
  'use strict'
  var seq = 0
  var pending = {}
  var handlers = {}
  function send(cmd, args) {
    return new Promise(function (resolve, reject) {
      var id = ++seq
      pending[id] = { resolve: resolve, reject: reject }
      window.parent.postMessage({ parley: 1, id: id, cmd: cmd, args: args || {} }, '*')
    })
  }
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return
    var m = e.data
    if (!m || m.parley !== 1) return
    if (m.id && pending[m.id]) {
      var p = pending[m.id]
      delete pending[m.id]
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result)
    } else if (m.evt && handlers[m.evt]) {
      handlers[m.evt].slice().forEach(function (f) { try { f(m.data) } catch (err) { console.error(err) } })
    }
  })
  window.ParleyActivity = {
    version: 1,
    ready: function () { return send('ready') },
    getParticipants: function () { return send('getParticipants') },
    setState: function (state) { return send('setState', { state: state }) },
    sendMessage: function (data) { return send('sendMessage', { data: data }) },
    authorize: function (scope) { return send('authorize', { scope: scope || 'identify' }) },
    openExternal: function (url) { return send('openExternal', { url: String(url) }) },
    close: function () { return send('close') },
    on: function (evt, f) {
      (handlers[evt] = handlers[evt] || []).push(f)
      return function () { handlers[evt] = (handlers[evt] || []).filter(function (g) { return g !== f }) }
    },
  }
})()
