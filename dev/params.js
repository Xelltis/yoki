// URL の後ろの ?tab= ?me= ?theme= を、画面が読む前（head の頭）に localStorage へ入れる。開くたびに最初の状態から始める
(function () {
  var q = new URLSearchParams(location.search);
  try {
    localStorage.removeItem('taku.cache');
    localStorage.removeItem('taku.tab');   // 最初はカレンダー。?tab=recruit などで最初の画面を選べる
    if (q.get('tab')) localStorage.setItem('taku.tab', q.get('tab'));
    if (q.get('me')) localStorage.setItem('taku.me', q.get('me'));
    else if (!localStorage.getItem('taku.me')) localStorage.setItem('taku.me', 'ひより');
    if (q.get('theme') === 'dark' || q.get('theme') === 'light') localStorage.setItem('taku.theme', q.get('theme'));
  } catch (e) {}
})();
