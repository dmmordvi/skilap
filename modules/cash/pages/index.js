var async = require("async");
var safe = require("safe");
var _ = require('underscore');

module.exports = function account(webapp) {
	var app = webapp.web;
	var cashapi = webapp.api;
	var prefix = webapp.prefix;
	var assetsTypes = ["BANK", "CASH", "ASSET", "STOCK", "MUTUAL", "CURENCY"];
	var liabilitiesTypes = ["CREDIT", "LIABILITY", "RECEIVABLE", "PAYABLE"];
	var repCmdty = {space:"ISO4217",id:"USD"};

	function getAssets(token, id, types, data, cb) {
		// filter this level data
		var level = _(data.accounts).filter(function (e) { 
			if (!_(types).include(e.type)) return false;
			if (id==null)
				return e.parentId==null || e.parentId.toString()==0
			else
				return e.parentId && e.parentId.toString() == id.toString(); 
		})
		var res = [];
		_(level).forEach (function (acc) {
			var det = {};
			det.cmdty = acc.cmdty;
			det.name = acc.name;
			det._id = acc._id;
			getAssets(token, acc._id, types,data, function (err,childs) {
				if (err) return cb(err);
				if (!_(repCmdty).isEqual(det.cmdty))
					det.quantity = acc.value;
				var rate = 1;
				var r = _(data.cmdty).find(function (e) { return e._id==acc.cmdty.id; });
				if (r!=null)
					rate = r.rate;
				det.value = parseFloat(webapp.i18n_cmdtyval(det.cmdty.id,acc.value*rate));
				det.childs = childs;
				_(childs).forEach (function (e) {
					det.value+=e.value;
				})
				det.fvalue = webapp.i18n_cmdtytext(token,repCmdty,det.value);
				if (det.quantity)
					det.fquantity = webapp.i18n_cmdtytext(token,det.cmdty,det.quantity);
				res.push(det);
			})
		})
		cb(null, res);
	}

	app.get(prefix, webapp.layout(), function(req, res, next) {
		var data;
		var settings = {};
		var assets = [];
		var liabilities = [];
		var currencies = [];
		var vtabs = [];
		async.series([
			function (cb) {
				webapp.guessTab(req, {pid:'home',name:webapp.ctx.i18n(req.session.apiToken, 'cash','Home'),url:req.url}, safe.sure_result(cb,function(val) {
					vtabs = val;
				}))
			},
			function getPageCurrency(cb) {
				// get tab settings first
				webapp.getTabSettings(req.session.apiToken, 'home', safe.sure(cb, function(cfg) {
					if (cfg && cfg.cmdty) {
						repCmdty = cfg.cmdty;
						cb()
					}
					else {
						// when absent get default
						cashapi.getSettings(req.session.apiToken, 'currency____', repCmdty, safe.sure(cb, function (defCmdty) {
							repCmdty = defCmdty;
							cb()
						}))
					}
				}));
			},
			function (cb) {
				var batch = {
					"setup":{
						"cmd":"object",
						"prm":{"token":req.session.apiToken,"repCmdty":repCmdty},
						"res":{"a":"merge"}
					},
					"accounts":{
						"dep":"setup",
						"cmd":"api",
						"prm":["cash.getAllAccounts","token"],
						"res":{"a":"store","v":"accounts"}
					},
					"filter":{
						"dep":"accounts",
						"cmd":"filter",
						"prm":["accounts","type",["BANK", "CASH", "ASSET", "STOCK", "MUTUAL", "CURENCY","CREDIT", "LIABILITY", "RECEIVABLE", "PAYABLE"],"IN"],
						"res":{"a":"store","v":"accounts"}
					},
					"info":{
						"dep":"filter",
						"cmd":"api",
						"ctx":{"a":"each","v":"accounts"},
						"prm":["cash.getAccountInfo","token","_id",["value"]],
						"res":{"a":"merge"}
					},
					"cmdty":{
						"dep":"filter",
						"cmd":"pluck",
						"prm":["accounts","cmdty","unique"],
						"res":{"a":"clone","v":"cmdty"}
					},
					"rates":{
						"dep":"cmdty",
						"cmd":"api",
						"ctx":{"a":"each","v":"cmdty"},
						"prm":["cash.getCmdtyPrice","token","this","repCmdty",null,"safe"],
						"res":{"a":"store","v":"rate"}
					}
				}
				webapp.ctx.runBatch(batch,safe.sure_result(cb, function (_data) {
					data = _data;
				}))
			},
			function (cb) {
				getAssets(req.session.apiToken, 0, assetsTypes, data, safe.sure_result(cb, function (res) {
					assets = res;
				}))
			},
			function (cb) {
				getAssets(req.session.apiToken, 0, liabilitiesTypes, data, safe.sure_result(cb, function (res) {
					liabilities = res;
				}))
			},
			function render () {
				var rdata = {
					settings: settings,
					prefix: prefix,
					tabs: vtabs,
					tabId: 'home'
				};
				rdata.assetsSum = webapp.i18n_cmdtytext(req.session.apiToken,repCmdty,_(assets).reduce(function (m,e) {return m+e.value;},0));
				rdata.liabilitiesSum = webapp.i18n_cmdtytext(req.session.apiToken,repCmdty,_(liabilities).reduce(function (m,e) {return m+e.value;},0));
				rdata.assets = assets;
				rdata.liabilities = liabilities;

				res.render(__dirname+"/../res/views/index", rdata);
			}],
			next
		);
	});
}
