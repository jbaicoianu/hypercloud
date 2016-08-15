<?php

class Component_hypercloud extends Component {
  public function init() {
    OrmManager::LoadModel("hypercloud");
  }

  public function controller_hypercloud($args) {
    $vars = array();
    return $this->GetComponentResponse("./hypercloud.tpl", $vars);
  }
}  
