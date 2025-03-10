/* -*- Mode: javascript; indent-tabs-mode: nil; c-basic-offset: 2 -*- */

(function() {
  'use strict';

  /**
   * @name Account
   * @constructor
   * @param {object} futureAccountData
   */
    function Account(futureAccountData) {
    // Data is immediately available
    if (typeof futureAccountData.then !== 'function') {
      angular.extend(this, futureAccountData);
      _.forEach(this.identities, function(identity) {
        if (identity.fullName && identity.email)
          identity.full = identity.fullName + ' <' + identity.email + '>';
        else if (identity.email)
          identity.full = '<' + identity.email + '>';
        else
          identity.full = '';
        if (identity.signature) {
          var element = angular.element('<div>' + identity.signature + '</div>');
          identity.textSignature = _.map(element.contents(), 'textContent').join(' ').trim();
        }
      });
      Account.$log.debug('Account: ' + JSON.stringify(futureAccountData, undefined, 2));
    }
    else {
      // The promise will be unwrapped first
      //this.$unwrap(futureAccountData);
    }
  }

  /**
   * @memberof Account
   * @desc The factory we'll use to register with Angular
   * @returns the Account constructor
   */
  Account.$factory = ['$q', '$timeout', '$log', 'sgSettings', 'Resource', 'Preferences', 'Mailbox', 'Message', function($q, $timeout, $log, Settings, Resource, Preferences, Mailbox, Message) {
    angular.extend(Account, {
      $q: $q,
      $timeout: $timeout,
      $log: $log,
      $$resource: new Resource(Settings.activeUser('folderURL') + 'Mail', Settings.activeUser()),
      $Preferences: Preferences,
      $Mailbox: Mailbox,
      $Message: Message
    });

    return Account; // return constructor
  }];

  /**
   * @module SOGo.MailerUI
   * @desc Factory registration of Account in Angular module.
   */
  try {
    angular.module('SOGo.MailerUI');
  }
  catch(e) {
    angular.module('SOGo.MailerUI', ['SOGo.Common']);
  }
  angular.module('SOGo.MailerUI')
    .factory('Account', Account.$factory);

  /**
   * @memberof Account
   * @desc Set the list of accounts and instanciate a new Account object for each item.
   * @param {array} [data] - the metadata of the accounts
   * @returns the list of accounts
   */
  Account.$findAll = function(data) {
    if (data) {
      return Account.$unwrapCollection(data);
    }
    else if (Account.$accounts) {
      return Account.$q.when(Account.$accounts);
    }
    else {
      return Account.$$resource.fetch('', 'mailAccounts').then(function(o) {
        return Account.$unwrapCollection(o);
      });
    }
  };

  /**
   * @memberof Account
   * @desc Unwrap to a collection of Account instances.
   * @param {object} data - the accounts information
   * @returns a collection of Account objects
   */
  Account.$unwrapCollection = function(data) {
    var collection = [];

    angular.forEach(data, function(o, i) {
      o.id = i;
      collection[i] = new Account(o);
    });
    Account.$accounts = collection;

    return collection;
  };

  /**
   * @memberof Account
   * @desc Refresh the unseen count for all required mailboxes.
   *       Starts a timer if user choose to automatically refresh folders.
   * @param {array} [string] - the paths of the folders
   */
  Account.refreshUnseenCount = function(folders) {
    var unseenCountFolders,
        fetchAllUnseenCountFolders = (Account.$Preferences.defaults.SOGoMailFetchAllUnseenCountFolders === 1),
        refreshViewCheck = Account.$Preferences.defaults.SOGoRefreshViewCheck;

    if (fetchAllUnseenCountFolders)
      unseenCountFolders = [];
    else if (folders)
      unseenCountFolders = folders;
    else
      throw Error('SOGoMailFetchAllUnseenCountFolders is disabled and no folders list provided');

    _.forEach(Account.$accounts, function(account) {
      if (fetchAllUnseenCountFolders) {
        // Include all mailboxes
        _.forEach(account.$$flattenMailboxes, function(mailbox) {
          unseenCountFolders.push(mailbox.id);
        });
      }
      else {
        // Always include the INBOX
        if (!_.includes(unseenCountFolders, account.id + '/folderINBOX'))
          unseenCountFolders.push(account.id + '/folderINBOX');

        _.forEach(account.$$flattenMailboxes, function(mailbox) {
          if (angular.isDefined(mailbox.unseenCount) &&
              !_.includes(unseenCountFolders, mailbox.id))
            unseenCountFolders.push(mailbox.id);
        });
      }
    });

    Account.$$resource.post('', 'unseenCount', {mailboxes: unseenCountFolders}).then(function(data) {
      _.forEach(Account.$accounts, function(account) {
        _.forEach(account.$$flattenMailboxes, function(mailbox) {
          if (angular.isDefined(data[mailbox.id])) {
            mailbox.unseenCount = data[mailbox.id];
          }
        });
      });
    });

    if (refreshViewCheck && refreshViewCheck != 'manually') {
      if (Account.$refreshUnseenCount)
        Account.$timeout.cancel(Account.$refreshUnseenCount);
      Account.$refreshUnseenCount = Account.$timeout(angular.bind(this, Account.refreshUnseenCount, folders), refreshViewCheck.timeInterval()*1000);
    }
  };

  /**
   * @function getLength
   * @memberof Account.prototype
   * @desc Used by md-virtual-repeat / md-on-demand
   * @returns the number of mailboxes in the account
   */
  Account.prototype.getLength = function() {
    if (this.$expanded)
      return this.$flattenMailboxes().length;
    else
      return 0;
  };

  /**
   * @function getItemAtIndex
   * @memberof Account.prototype
   * @desc Used by md-virtual-repeat / md-on-demand
   * @returns the mailbox at the specified index
   */
  Account.prototype.getItemAtIndex = function(index) {
    var expandedMailboxes;

    expandedMailboxes = this.$flattenMailboxes();
    if (index >= 0 && index < expandedMailboxes.length)
      return expandedMailboxes[index];

    return null;
  };

  /**
   * @function $getMailboxes
   * @memberof Account.prototype
   * @desc Fetch the list of mailboxes for the current account.
   * @param {object} [options] - force a reload by setting 'reload' to true
   * @returns a promise of the HTTP operation
   */
  Account.prototype.$getMailboxes = function(options) {
    var _this = this, reload = (options && options.reload);

    if (this.$mailboxes && !reload) {
      return Account.$q.when(this.$mailboxes);
    }
    else if (!reload && this.$futureMailboxesData) {
      return this.$futureMailboxesData;
    }
    else {
      this.$futureMailboxesData = Account.$Mailbox.$find(this, options).then(function(data) {
        var previousMailboxes = _this.$flattenMailboxes({ all: true });
        _this.$mailboxes = data;
        _this.$expanded = false;

        // Restore unseen count
        var _visitForUnseencount = function(mailboxes) {
          _.forEach(mailboxes, function(o) {
            var previousMailbox = _.find(previousMailboxes, ['id', o.id]);
            if (previousMailbox) {
              o.unseenCount = previousMailbox.unseenCount;
            }
            if (o.children && o.children.length > 0) {
              _visitForUnseencount(o.children);
            }
          });
        };
        _visitForUnseencount(_this.$mailboxes);

        // Set expanded folders from user's settings
        var expandedFolders,
            _visitForExpanded = function(mailboxes) {
              _.forEach(mailboxes, function(o) {
                o.$expanded = (expandedFolders.indexOf('/' + o.id) >= 0);
                if (o.children && o.children.length > 0) {
                  _visitForExpanded(o.children);
                }
              });
            };
        if (Account.$Preferences.settings.Mail.ExpandedFolders) {
          if (angular.isString(Account.$Preferences.settings.Mail.ExpandedFolders)) {
            // Backward compatibility support
            try {
              expandedFolders = angular.fromJson(Account.$Preferences.settings.Mail.ExpandedFolders);
            }
            catch (e) {
              Account.$log.warn("Can't parse list of expanded folders. String was: " +
                                Account.$Preferences.settings.Mail.ExpandedFolders);
              expandedFolders = [];
            }
          }
          else {
            expandedFolders = Account.$Preferences.settings.Mail.ExpandedFolders;
          }
          _this.$expanded = (expandedFolders.indexOf('/' + _this.id) >= 0);
          if (expandedFolders.length > 0) {
            _visitForExpanded(_this.$mailboxes);
          }
        }
        if (Account.$accounts)
          _this.$expanded |= (Account.$accounts.length == 1); // Always expand single account

        _this.$flattenMailboxes({reload: true});

        return _this.$mailboxes;
      });
      return this.$futureMailboxesData;
    }
  };

  /**
   * @function $flattenMailboxes
   * @memberof Account.prototype
   * @desc Get a flatten array of the mailboxes.
   * @param {object} [options] - the following boolean attributes are available:
   *   - reload: rebuild the flatten array of mailboxes from the original tree representation (this.$mailboxes)
   *   - all: return all mailboxes, ignoring their expanstion state
   *   - saveState: save expansion state of mailboxes to the server
   * @returns an array of Mailbox instances
   */
  Account.prototype.$flattenMailboxes = function(options) {
    var _this = this,
        allMailboxes = [],
        expandedMailboxes = [],
        _visit = function(mailboxes) {
          _.forEach(mailboxes, function(o) {
            allMailboxes.push(o);
            if ((options && options.all || o.$expanded) && o.children && o.children.length > 0) {
              _visit(o.children);
            }
          });
        };

    if (this.$$flattenMailboxes && !(options && (options.reload || options.all))) {
      allMailboxes = this.$$flattenMailboxes;
    }
    else {
      _visit(this.$mailboxes);
      if (!options || !options.all) {
        _this.$$flattenMailboxes = allMailboxes;
        if (options && options.saveState) {
          // Save expansion state of mailboxes to the server
          _.forEach(Account.$accounts, function(account) {
            if (account.$expanded) {
              expandedMailboxes.push('/' + account.id);
            }
            _.reduce(account.$$flattenMailboxes, function(expandedFolders, mailbox) {
              if (mailbox.$expanded) {
                expandedFolders.push('/' + mailbox.id);
              }
              return expandedFolders;
            }, expandedMailboxes);
          });
          Account.$$resource.post(null, 'saveFoldersState', expandedMailboxes);
        }
      }
    }

    return allMailboxes;
  };

  Account.prototype.$getMailboxByType = function(type) {
    var mailbox,
        // Recursive find function
        _find = function(mailboxes) {
          var mailbox = _.find(mailboxes, function(o) {
            return o.type == type;
          });
          if (!mailbox) {
            angular.forEach(mailboxes, function(o) {
              if (!mailbox && o.children && o.children.length > 0) {
                mailbox = _find(o.children);
              }
            });
          }
          return mailbox;
        };
    mailbox = _find(this.$mailboxes);

    return mailbox;
  };

  /**
   * @function $getMailboxByPath
   * @memberof Account.prototype
   * @desc Recursively find a mailbox using its path
   * @returns a promise of the HTTP operation
   */
  Account.prototype.$getMailboxByPath = function(path) {
    var mailbox = null,
        // Recursive find function
        _find = function(mailboxes) {
          var mailbox = _.find(mailboxes, function(o) {
            return o.path == path;
          });
          if (!mailbox) {
            angular.forEach(mailboxes, function(o) {
              if (!mailbox && o.children && o.children.length > 0) {
                mailbox = _find(o.children);
              }
            });
          }
          return mailbox;
        };
    mailbox = _find(this.$mailboxes);

    return mailbox;
  };

  /**
   * @function $newMailbox
   * @memberof Account.prototype
   * @desc Create a new mailbox on the server and refresh the list of mailboxes.
   * @returns a promise of the HTTP operations
   */
  Account.prototype.$newMailbox = function(path, name) {
    var _this = this;

    return Account.$$resource.post(path.toString(), 'createFolder', {name: name}).then(function() {
      _this.$getMailboxes({reload: true});
    });
  };

  /**
   * @function getTextSignature
   * @memberof Account.prototype
   * @desc Create a plain text representation of the signature for the specified identity index.
   * @returns a plain text version of the signature
   */
  Account.prototype.getTextSignature = function(identity) {
    if (identity.signature) {
      var element = angular.element('<div>' + identity.signature + '</div>');
      identity.textSignature = _.map(element.contents(), 'textContent').join(' ').trim();
    } else {
      identity.textSignature = '';
    }
    return identity.textSignature;
  };

  /**
   * @function $hasCertificate
   * @memberof Account.prototype
   * @desc Return true if the user has a S/MIME certificate for this account
   * @returns a boolean value
   */
  Account.prototype.$hasCertificate = function() {
    return this.security && this.security.hasCertificate;
  };

  /**
   * @function $certificate
   * @memberof Account.prototype
   * @desc View the S/MIME certificate details associated to the account.
   * @returns a promise of the HTTP operation
   */
  Account.prototype.$certificate = function() {
    var _this = this;

    if (this.$hasCertificate()) {
      if (this.$$certificate)
        return Account.$q.when(this.$$certificate);
      else {
        return Account.$$resource.fetch(this.id.toString(), 'certificate').then(function(data) {
          _this.$$certificate = data;
          return data;
        });
      }
    }
    else {
      return Account.$q.reject();
    }
  };

  /**
   * @function $removeCertificate
   * @memberof Account.prototype
   * @desc Remove any S/MIME certificate associated with the account.
   * @returns a promise of the HTTP operation
   */
  Account.prototype.$removeCertificate = function() {
    var _this = this;

    return Account.$$resource.fetch(this.id.toString(), 'removeCertificate').then(function() {
      _this.security.hasCertificate = false;
    });
  };

  /**
   * @function updateQuota
   * @memberof Account.prototype
   * @param {Object} data - the inbox quota information returned by the server
   * @desc Update the quota definition associated to the account
   */
  Account.prototype.updateQuota = function(data) {
    var percent, format, description;

    if (data.maxQuota) {
      percent = (Math.round(data.usedSpace * 10000 / data.maxQuota) / 100);
      format = l("quotasFormat");
      description = format.formatted(percent, Math.round(data.maxQuota/10.24)/100);
    }
    else if (data.maxMessages) {
      percent = (Math.round(data.messagesCount * 10000 / data.maxMessages) / 100);
      format = l("messageQuotasFormat");
      description = format.formatted(percent, data.maxMessages);
    }

    this.$quota = { percent: percent, description: description };
  };

  /**
   * @function $newMessage
   * @memberof Account.prototype
   * @desc Prepare a new Message object associated to the appropriate mailbox.
   * @returns a promise of the HTTP operations
   */
  Account.prototype.$newMessage = function(options) {
    var _this = this;

    // Query account for draft folder and draft UID
    return Account.$$resource.fetch(this.id.toString(), 'compose').then(function(data) {
      Account.$log.debug('New message (compose): ' + JSON.stringify(data, undefined, 2));
      var message = new Account.$Message(data.accountId, _this.$getMailboxByPath(data.mailboxPath), data);
      return message;
    }).then(function(message) {
      // Fetch draft initial data
      return Account.$$resource.fetch(message.$absolutePath({asDraft: true}), 'edit').then(function(data) {
        var accountDefaults = Account.$Preferences.defaults.AuxiliaryMailAccounts[_this.id];
        if (accountDefaults.security) {
          if (accountDefaults.security.alwaysSign)
            data.sign = true;
          if (accountDefaults.security.alwaysEncrypt)
            data.encrypt = true;
        }
        Account.$log.debug('New message (edit): ' + JSON.stringify(data, undefined, 2));
        angular.extend(message.editable, data);
        message.isNew = true;
        if (options && options.mailto) {
          if (angular.isObject(options.mailto))
            angular.extend(message.editable, options.mailto);
          else
            message.$parseMailto(options.mailto);
        }
        return message;
      });
    });
  };

  /**
   * @function $addDelegate
   * @memberof Account.prototype
   * @param {Object} user - a User object with minimal set of attributes (uid, isGroup, cn, c_email)
   * @desc Remove a user from the account's delegates
   * @see {@link User.$filter}
   */
  Account.prototype.$addDelegate = function(user) {
    var _this = this,
        deferred = Account.$q.defer(),
        param = {uid: user.uid};
    if (!user.uid || _.indexOf(_.map(this.delegates, 'uid'), user.uid) > -1) {
      // No UID specified or user already in delegates
      deferred.resolve();
    }
    else {
      Account.$$resource.fetch(this.id.toString(), 'addDelegate', param).then(function() {
        _this.delegates.push(user);
        deferred.resolve(_this.users);
      }, function(data, status) {
        deferred.reject(l('An error occured, please try again.'));
      });
    }
    return deferred.promise;
  };

  /**
   * @function $removeDelegate
   * @memberof Account.prototype
   * @param {Object} user - a User object with minimal set of attributes (uid, isGroup, cn, c_email)
   * @desc Remove a user from the account's delegates
   * @return a promise of the server call to remove the user from the account's delegates
   */
  Account.prototype.$removeDelegate = function(uid) {
    var _this = this,
        param = {uid: uid};
    return Account.$$resource.fetch(this.id.toString(), 'removeDelegate', param).then(function() {
      var i = _.indexOf(_.map(_this.delegates, 'uid'), uid);
      if (i >= 0) {
        _this.delegates.splice(i, 1);
      }
    });
  };

  /**
   * @function $omit
   * @memberof Account.prototype
   * @desc Return a sanitized object used to send to the server.
   * @return an object literal copy of the Account instance
   */
  Account.prototype.$omit = function () {
    var account = {}, identities = [], defaultIdentity = false;

    angular.forEach(this, function(value, key) {
      if (key != 'constructor' && key !='identities' && key[0] != '$') {
        account[key] = angular.copy(value);
      }
    });

    _.forEach(this.identities, function (identity) {
      if (!identity.isReadOnly)
        identities.push(_.pick(identity, ['email', 'fullName', 'replyTo', 'signature', 'isDefault']));
      if (identity.isDefault)
        defaultIdentity = identity;
    });
    account.identities = identities;

    if (!defaultIdentity || !account.forceDefaultIdentity)
      delete account.forceDefaultIdentity;

    return account;
  };

})();
